import {
	type AnyEntity,
	type KitSpec,
	membersOf,
	type ResolvedMember,
	resolveMember,
	type TypeSpec,
} from "../kit";
import type {
	InputPlan,
	PlacedPlan,
	Shape,
	ValuePlan,
	ValueTypePlan,
} from "../plan";
import { std } from "../std";
import { type Json, ok, type Path } from "../values";
import { type Compiler, compile, toJson } from "./compile";
import type { Checked, Diagnostic } from "./types";

/** A placement in a Builder's tree, as the checker reads it. */
interface Node {
	readonly type?: unknown;
	readonly use?: unknown;
	readonly config?: Readonly<Record<string, unknown>>;
	readonly inputs?: Readonly<Record<string, unknown>>;
}
/** A shape while it is being built: its values are compiled once every shape exists. */
interface Draft {
	readonly shape: Shape & {
		values: Record<string, ValuePlan>;
	};
	/** The expressions still to compile, by member name. */
	readonly formulas: Map<string, { expr: unknown; at: Path; field: string }>;
}

/**
 * Checks a Builder's tree against a kit and compiles it. A mistake becomes a
 * diagnostic, and the value it breaks computes to an error, so the rest of
 * the program still runs.
 *
 * It works in two passes. The first builds a shape for every placement and
 * every entity an Operator can add, so every path has something to resolve
 * against. The second compiles every expression.
 */
export function check(spec: KitSpec, tree: unknown): Checked {
	const diagnostics: Diagnostic[] = [];
	const drafts = new Map<string, Draft>();
	const report = (d: Diagnostic) => diagnostics.push(d);

	/** The shape for an entity an Operator adds, such as a list's rows: placed without Builder formulas. */
	const elementShape = (entity: AnyEntity, at: Path): string => {
		if (!drafts.has(entity.name)) place(entity.name, entity, {}, at);
		return entity.name;
	};

	/** The entities a member type may hold: the entity, a trait's implementers, or each of `t.oneOf` and `t.all`. */
	const allowed = (member: ResolvedMember): AnyEntity[] => {
		switch (member["~kind"]) {
			case "entity":
				return [member];
			case "trait":
				return spec.entities.filter((e) => implementsTrait(e, member.name));
			case "oneOf":
				return [
					...new Set(
						(member["~of"] as readonly unknown[]).flatMap((x) =>
							allowed(resolveMember(x as ResolvedMember)),
						),
					),
				];
			case "all":
				return spec.entities.filter((e) =>
					(member["~of"] as readonly { name: string }[]).every((t) =>
						implementsTrait(e, t.name),
					),
				);
			default:
				return [];
		}
	};

	/** A node the Builder placed in a member of type `member`: its shape id, or undefined with a diagnostic. */
	const placeNode = (
		member: ResolvedMember,
		node: unknown,
		id: string,
		at: Path,
	): string | undefined => {
		const n = asRecord(node) as Node | undefined;
		if (n?.use !== undefined) {
			report({
				code: "skeleton.unsupported",
				message: "components come with #23",
				at,
			});
			return undefined;
		}
		const options = allowed(member);
		const entity = options.find((e) => e.name === n?.type);
		if (!entity) {
			const known = spec.entities.some((e) => e.name === n?.type);
			report({
				code: known ? "node.type" : "node.unknown",
				message: known
					? `a ${String(n?.type)} can't go here; it takes ${options.map((e) => e.name).join(", ") || "nothing yet"}`
					: `the kit has no entity ${JSON.stringify(n?.type)}`,
				at,
			});
			return undefined;
		}
		place(id, entity, n as Node, at);
		return id;
	};

	/** Builds the shape for one placement of `entity`, and those of everything placed in it. */
	const place = (id: string, entity: AnyEntity, node: Node, at: Path): void => {
		const def = membersOf(entity);
		const inputs: Record<string, InputPlan> = {};
		const placed: Record<string, PlacedPlan> = {};
		const values: Record<string, ValuePlan> = {};
		const draft: Draft = {
			shape: { id, entity: entity.name, inputs, values, placed },
			formulas: new Map(),
		};
		// Reserve the id first, so an entity that holds its own kind doesn't recurse forever.
		drafts.set(id, draft);

		for (const [name, member] of Object.entries(def.inputs)) {
			const override = node.inputs?.[name];
			if (member["~kind"] === "initial") {
				inputs[name] = {
					kind: "value",
					type: typePlan(member.type.spec),
					initial: toJson(override ?? member.value),
				};
			} else if (member["~kind"] === "value") {
				inputs[name] = {
					kind: "value",
					type: typePlan(member.spec),
					initial: toJson(override ?? null),
				};
			} else if (member["~kind"] === "list" || member["~kind"] === "map") {
				const element = resolveMember(member["~of"]);
				if (element["~kind"] === "entity") {
					inputs[name] = {
						kind: member["~kind"],
						of: elementShape(element, [...at, name]),
					};
				} else unsupported(at, name, "a collection of values or traits");
			} else if (member["~kind"] === "entity") {
				// A fixed entity: the program places it, and the Operator fills it in.
				place(`${id}/${name}`, member, asRecord(override) ?? {}, [...at, name]);
				placed[name] = { kind: "entity", shape: `${id}/${name}` };
			} else {
				unsupported(at, name, "this kind of input");
			}
		}

		for (const [name, declared] of Object.entries(def.config)) {
			let member = declared;
			const given = node.config?.[name];
			if (member["~kind"] === "optional") {
				if (given === undefined) {
					// Left out: reads as null for now; fallbacks come with nullability (#14).
					values[name] = constant(null);
					continue;
				}
				member = resolveMember(member["~of"]);
			}
			switch (member["~kind"]) {
				case "expr":
					if (given === undefined) {
						report({
							code: "config.missing",
							message: `"${name}" needs a formula`,
							at,
							field: name,
						});
					}
					draft.formulas.set(name, {
						expr: given ?? null,
						at,
						field: name,
					});
					break;
				case "value":
					values[name] = constant(toJson(given ?? null));
					break;
				case "map":
				case "list":
					placed[name] = placeAll(
						member["~kind"],
						resolveMember(member["~of"]),
						given,
						`${id}/${name}`,
						[...at, name],
					);
					break;
				case "entity":
				case "trait":
				case "oneOf":
				case "all": {
					if (given === undefined) {
						report({
							code: "config.missing",
							message: `"${name}" needs an entity`,
							at,
							field: name,
						});
						break;
					}
					const shape = placeNode(member, given, `${id}/${name}`, [
						...at,
						name,
					]);
					if (shape) placed[name] = { kind: "entity", shape };
					break;
				}
				default:
					unsupported(at, name, "this kind of config");
			}
		}

		for (const [name, expr] of Object.entries(def.derived)) {
			draft.formulas.set(name, { expr, at, field: name });
		}
	};

	/** The elements the Builder placed in a config map or list. */
	const placeAll = (
		kind: "map" | "list",
		member: ResolvedMember,
		given: unknown,
		id: string,
		at: Path,
	): PlacedPlan => {
		const elements: { id: string; shape: string }[] = [];
		if (kind === "map") {
			for (const [key, node] of Object.entries(asRecord(given) ?? {})) {
				if (!/^[A-Za-z]/.test(key)) {
					report({
						code: "key.invalid",
						message: `"${key}" must start with a letter`,
						at,
					});
					continue;
				}
				const shape = placeNode(member, node, `${id}/${key}`, [...at, key]);
				if (shape) elements.push({ id: key, shape });
			}
		} else {
			const nodes = Array.isArray(given) ? given : [];
			nodes.forEach((node, i) => {
				const shape = placeNode(member, node, `${id}/${i}`, [...at, i]);
				if (shape) elements.push({ id: String(i), shape });
			});
		}
		return { kind, elements };
	};

	const unsupported = (at: Path, field: string, what: string): void => {
		report({
			code: "skeleton.unsupported",
			message: `${what} isn't supported yet`,
			at,
			field,
		});
	};

	place("$root", spec.root, (asRecord(tree) ?? {}) as Node, []);

	const compiler: Compiler = {
		// std's functions unless `stdFunctions` says otherwise, with the kit's own on top.
		functions: { ...(spec.stdFunctions ?? std), ...spec.functions },
		shapes: {
			get: (id) => drafts.get(id)?.shape,
			valueNames: (id) => {
				const draft = drafts.get(id);
				return new Set([
					...Object.keys(draft?.shape.values ?? {}),
					...(draft?.formulas.keys() ?? []),
				]);
			},
		},
		report,
	};
	for (const { shape, formulas } of drafts.values()) {
		for (const [name, { expr, at, field }] of formulas) {
			shape.values[name] = compile(
				expr,
				{ shape: shape.id, at, field },
				compiler,
			);
		}
	}

	const shapes = new Map<string, Shape>();
	for (const [id, { shape }] of drafts) shapes.set(id, shape);
	return { plan: { root: "$root", shapes }, diagnostics };
}

function implementsTrait(entity: AnyEntity, trait: string): boolean {
	const impls = (entity["~def"].impls ?? []) as readonly {
		"~trait": { name: string };
	}[];
	return impls.some((i) => i["~trait"].name === trait);
}

function constant(value: Json): ValuePlan {
	const r = ok(value);
	return { expr: value, refs: [], compute: () => r };
}

function typePlan(spec: TypeSpec): ValueTypePlan {
	return {
		base: spec.base,
		nullable: spec.nullable,
		...(spec.scale === undefined ? {} : { scale: spec.scale }),
		...(spec.values === undefined ? {} : { values: spec.values }),
	};
}

/** A plain object; not an array or `null`. */
function asRecord(x: unknown): Record<string, unknown> | undefined {
	return typeof x === "object" && x !== null && !Array.isArray(x)
		? (x as Record<string, unknown>)
		: undefined;
}
