import { callsIn, recursion } from "./calls";
import { paramList } from "./define";
import type { AnyEntity, AnyTrait } from "./entity";
import type { KitSpec } from "./kit";
import { membersOf, resolveMember } from "./members";
import type { ResolvedMember } from "./types";

/**
 * What `kit()` checks before any program exists: mistakes in your own
 * definitions, which no Builder could fix. Each one throws, naming the
 * entity and the member.
 *
 * - An entity's member names are unique across config, inputs and derived.
 * - No member name has a `:`, which an address uses for a trait's members.
 * - Two traits never share a name.
 * - An entity implements each trait once, and its impl gives every member
 *   without a default, and nothing else.
 * - A trait-typed input starts as an entity that implements the trait.
 * - A trait member that holds an entity or a collection is given as one of
 *   the entity's own members, of the same kind: `{ customer:
 *   e.self("customer") }`. A derived member that `e.entity`, `map` or
 *   `filter` builds counts. Every entity that member may hold fits the trait
 *   member's type.
 * - `e.entity` builds one of the kit's entities, which has no config and
 *   only value inputs, and gives an expression for each input.
 * - No function with a `body` calls itself, directly or through others.
 */
export function validateKit(spec: KitSpec): void {
	const calls = new Map<string, Set<string>>();
	for (const [name, f] of Object.entries(spec.functions ?? {})) {
		const called = new Set<string>();
		for (const s of f.signatures) {
			if (!s.body) continue;
			const params = paramList(name, s).map(([k]) => [k, ["ref", k]]);
			callsIn(s.body(Object.fromEntries(params)), called);
		}
		calls.set(name, called);
	}
	const loop = recursion(calls);
	if (loop) {
		throw new Error(
			loop.length === 2
				? `thence: "${loop[0]}" calls itself`
				: `thence: "${loop[0]}" calls itself through ${loop
						.slice(1, -1)
						.map((n) => `"${n}"`)
						.join(", ")}`,
		);
	}

	const traits = new Map<string, AnyTrait>();
	for (const entity of spec.entities) {
		const def = entity["~def"];
		const where = (what: string) => `thence: ${entity.name}: ${what}`;
		const seen = new Set<string>();
		for (const part of ["config", "inputs", "derived"] as const) {
			for (const name of Object.keys(def[part] ?? {})) {
				if (seen.has(name))
					throw new Error(where(`"${name}" is declared twice`));
				if (name.includes(":")) {
					throw new Error(where(`"${name}" can't have a ":" in its name`));
				}
				seen.add(name);
			}
		}

		const implemented = new Set<string>();
		for (const i of def.impls ?? []) {
			const trait: AnyTrait = i["~trait"];
			const other = traits.get(trait.name);
			if (other && other !== trait) {
				throw new Error(`thence: two traits are named "${trait.name}"`);
			}
			traits.set(trait.name, trait);
			if (implemented.has(trait.name)) {
				throw new Error(where(`it implements ${trait.name} twice`));
			}
			implemented.add(trait.name);
		}

		const members = membersOf(entity);
		for (const [name, expr] of Object.entries(def.derived ?? {})) {
			const built: unknown[][] = [];
			entityCalls(expr, built);
			for (const [, type, inputs] of built) {
				const problem = builtEntityProblem(spec, type, inputs);
				if (problem) throw new Error(where(`"${name}": ${problem}`));
			}
		}
		for (const [name, input] of Object.entries(members.inputs)) {
			if (
				input["~kind"] === "traitInitial" &&
				!implementsTrait(input["~entity"], input["~trait"].name)
			) {
				throw new Error(
					where(
						`"${name}" starts as ${input["~entity"].name}, which doesn't implement ${input["~trait"].name}`,
					),
				);
			}
		}
		for (const [name, impl] of Object.entries(members.impls)) {
			const given = (def.impls ?? []).find(
				(i: { "~trait": AnyTrait }) => i["~trait"].name === name,
			)?.body as Record<string, unknown>;
			for (const member of Object.keys(given)) {
				if (!(member in impl.types)) {
					throw new Error(where(`${name} has no member "${member}"`));
				}
			}
			for (const [member, type] of Object.entries(impl.types)) {
				const expr = impl.body[member];
				if (expr === undefined) {
					throw new Error(where(`its impl of ${name} needs "${member}"`));
				}
				const kind = memberKind(type);
				if (kind === "value") continue;
				const own = aliasOf(expr);
				const ownType =
					own === undefined ? undefined : ownMember(spec, entity, own);
				const ownKind = ownType && memberKind(resolveMember(ownType));
				if (ownKind !== kind) {
					throw new Error(
						where(
							`${name}.${member} holds ${kind === "entity" ? "an entity" : `a ${kind}`}, so the impl gives one of the entity's own config or input members of that kind, such as e.self("${member}")`,
						),
					);
				}
				if (ownType && !fits(held(ownType), held(type))) {
					throw new Error(
						where(
							`"${own}" may hold an entity that ${name}.${member} doesn't allow`,
						),
					);
				}
			}
		}
	}
}

/** Whether a member holds a value, one entity, a list or a map. A list of values is a value. */
export function memberKind(
	type: ResolvedMember,
): "value" | "entity" | "list" | "map" {
	switch (type["~kind"]) {
		case "list":
		case "map": {
			const of = memberKind(resolveMember(type["~of"]));
			return of === "value" ? "value" : type["~kind"];
		}
		case "entity":
		case "trait":
		case "traitInitial":
		case "oneOf":
		case "all":
			return "entity";
		default:
			return "value";
	}
}

/**
 * What one entity a member holds may be: an entity, or any entity that
 * implements every one of some traits. A collection's elements, a
 * `t.oneOf` each of its options.
 */
type Held =
	| { readonly entity: AnyEntity }
	| { readonly traits: readonly AnyTrait[] };

function held(type: ResolvedMember): readonly Held[] {
	switch (type["~kind"]) {
		case "list":
		case "map":
			return held(resolveMember(type["~of"]));
		case "entity":
			return [{ entity: type as AnyEntity }];
		case "trait":
			return [{ traits: [type as AnyTrait] }];
		case "traitInitial":
			return [{ traits: [type["~trait"]] }];
		case "all":
			return [{ traits: type["~of"] }];
		case "oneOf":
			return (type["~of"] as readonly ResolvedMember[]).flatMap((x) =>
				held(resolveMember(x)),
			);
		default:
			return [];
	}
}

/**
 * Whether every entity `own` may hold is one `want` allows. An entity named
 * only by its traits fits a trait it lists, never one entity in particular.
 */
function fits(own: readonly Held[], want: readonly Held[]): boolean {
	return own.every((o) =>
		want.some((w) =>
			"entity" in w
				? "entity" in o && o.entity.name === w.entity.name
				: w.traits.every((t) =>
						"entity" in o
							? implementsTrait(o.entity, t.name)
							: o.traits.some((ot) => ot.name === t.name),
					),
		),
	);
}

/**
 * An entity's own member type by name: config, an input, or a derived
 * member that holds an entity or a collection, as `e.entity`, `map` and
 * `filter` build them.
 */
function ownMember(
	spec: KitSpec,
	entity: AnyEntity,
	name: string,
	seen = new Set<string>(),
): ResolvedMember | undefined {
	const members = membersOf(entity);
	const declared = members.config[name] ?? members.inputs[name];
	if (declared) return declared;
	const expr = members.derived[name];
	if (seen.has(name) || !Array.isArray(expr)) return undefined;
	seen.add(name);
	const kitEntity = (type: unknown) =>
		spec.entities.find((e) => e.name === type) as ResolvedMember | undefined;
	if (expr[0] === "entity") return kitEntity(expr[1]);
	// A map that builds entities holds them in a collection of the source's kind.
	const lambda = expr[2];
	const body =
		expr[0] === "map" && Array.isArray(lambda) && lambda[0] === "fn"
			? lambda[2]
			: undefined;
	if (expr[0] === "map" && !(Array.isArray(body) && body[0] === "entity")) {
		return undefined;
	}
	let source: unknown = expr[0] === "map" ? expr[1] : expr;
	while (Array.isArray(source) && source[0] === "filter") source = source[1];
	const from = aliasOf(source);
	const over =
		from === undefined ? undefined : ownMember(spec, entity, from, seen);
	if (!over || (over["~kind"] !== "list" && over["~kind"] !== "map")) {
		return undefined;
	}
	if (expr[0] === "filter") return over;
	const built = kitEntity((body as unknown[])[1]);
	return built && ({ "~kind": over["~kind"], "~of": built } as ResolvedMember);
}

/** Every `["entity", type, inputs]` in an expression. */
function entityCalls(x: unknown, out: unknown[][]): void {
	if (!Array.isArray(x)) return;
	if (x[0] === "entity") out.push(x);
	for (const y of x) entityCalls(y, out);
}

/** What is wrong with an `e.entity(type, inputs)`; `undefined` when nothing is. */
function builtEntityProblem(
	spec: KitSpec,
	type: unknown,
	inputs: unknown,
): string | undefined {
	const built = spec.entities.find((e) => e.name === type);
	if (!built) {
		return `e.entity(${String(type)}) builds an entity that isn't in the kit's entities`;
	}
	const members = membersOf(built);
	if (Object.keys(members.config).length > 0) {
		return `e.entity(${built.name}) needs an entity without config`;
	}
	const given = (inputs ?? {}) as Record<string, unknown>;
	for (const [input, member] of Object.entries(members.inputs)) {
		if (member["~kind"] !== "initial" && member["~kind"] !== "value") {
			return `e.entity(${built.name}) needs an entity whose inputs are all values, and "${input}" isn't`;
		}
		if (given[input] === undefined) {
			return `e.entity(${built.name}) needs an expression for "${input}"`;
		}
	}
	for (const input of Object.keys(given)) {
		if (!(input in members.inputs)) {
			return `${built.name} has no input "${input}"`;
		}
	}
	return undefined;
}

/** The member an expression names when it is just `e.self(name)`. */
function aliasOf(expr: unknown): string | undefined {
	return Array.isArray(expr) &&
		expr.length === 2 &&
		expr[0] === "ref" &&
		typeof expr[1] === "string"
		? expr[1]
		: undefined;
}

/** Whether an entity implements the trait with this name. */
export function implementsTrait(entity: AnyEntity, trait: string): boolean {
	return trait in membersOf(entity).impls;
}
