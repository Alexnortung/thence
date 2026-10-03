import { callsIn, recursion } from "./calls";
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
 *   the entity's own config or input members, of the same kind:
 *   `{ customer: e.self("customer") }`.
 * - No function with a `body` calls itself, directly or through others.
 */
export function validateKit(spec: KitSpec): void {
	const calls = new Map<string, Set<string>>();
	for (const [name, f] of Object.entries(spec.functions ?? {})) {
		const called = new Set<string>();
		for (const s of f.signatures) {
			if (!s.body) continue;
			const params = Object.keys(s.params).map((k) => [k, ["ref", k]]);
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
					own === undefined
						? undefined
						: (members.config[own] ?? members.inputs[own]);
				const ownKind = ownType && memberKind(resolveMember(ownType));
				if (ownKind !== kind) {
					throw new Error(
						where(
							`${name}.${member} holds ${kind === "entity" ? "an entity" : `a ${kind}`}, so the impl gives one of the entity's own config or input members of that kind, such as e.self("${member}")`,
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
