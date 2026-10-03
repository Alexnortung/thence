import {
	type AnyEntity,
	implementsTrait,
	type KitSpec,
	memberKind,
	membersOf,
	type ResolvedMember,
	resolveMember,
	type TypeSpec,
} from "../kit";
import type {
	Address,
	Check,
	InputPlan,
	PlacedPlan,
	Shape,
	TraitPlan,
	ValuePlan,
	ValueTypePlan,
} from "../plan";
import { decode, toJson, traitSegment } from "../plan";
import { fail, type Json, ok, type Path, type Result } from "../values";
import { checkOf, validate } from "./checks";
import { type Compiled, type Compiler, compile } from "./compile";
import { markCycles, type ValueNode } from "./cycles";
import { withBuilderFunctions } from "./functions";
import type { Holder, Placed } from "./paths";
import type { Checked, Diagnostic, Part } from "./types";
import { ANY, fromSpec, nullable, type StaticType } from "./typing";

/** An enum the Builder defines, as a `t.enum.def()` config member holds it. */
interface BuilderEnum {
	readonly values: readonly string[];
	readonly meta?: Readonly<Record<string, Json>>;
}
/** A placement in a Builder's tree, as the checker reads it. */
interface Node {
	readonly type?: unknown;
	readonly meta?: Json;
	readonly use?: unknown;
	readonly config?: Readonly<Record<string, unknown>>;
	readonly inputs?: Readonly<Record<string, unknown>>;
}
/** A shape while it is being built: its values are compiled once every shape exists. */
interface Draft {
	readonly shape: Shape;
	/** The expressions still to compile, and where each value goes. */
	readonly formulas: Formula[];
	/** The names of the entity's own values still to compile. */
	readonly valueNames: Set<string>;
	/** The names of each trait's value members. */
	readonly traitValues: Map<string, Set<string>>;
	/** Where the program placed the shape's one instance. */
	readonly holder: Holder | undefined;
	/** The shape of the outermost instance it is placed in, and its address from there; see {@link Placement}. */
	readonly top: string;
	readonly segments: Address;
	/** Where it is in the Builder's tree. */
	readonly at: Path;
	/** The type of each of the entity's own value members; a derived value's is worked out when first asked. */
	readonly types: Map<string, () => StaticType>;
	/** The declared type of each trait's value members. */
	readonly traitTypes: Map<string, Map<string, StaticType>>;
}
/** An expression still to compile. */
interface Formula {
	readonly expr: unknown;
	readonly at: Path;
	readonly field: string;
	/** Whether a Builder wrote it, so it sees the Builder's scope. */
	readonly builder: boolean;
	/** The type declared where it goes. */
	readonly expect?: TypeSpec;
	/** The value's segments in its instance: `["total"]`, or `["as:priced", "total"]`. */
	readonly suffix: Address;
	/** The `seeds` entry the entity declares for it, for a cycle. */
	readonly seed?: unknown;
	readonly put: (value: ValuePlan) => void;
	/** Set once compiled, which may happen early, when another formula needs its type. */
	compiled?: Compiled;
	/** Set while compiling, so two values whose types need each other don't recurse. */
	busy?: boolean;
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
	const parts: Part[] = [];
	const drafts = new Map<string, Draft>();
	const report = (d: Diagnostic) => diagnostics.push(d);

	/**
	 * The shape for an entity an Operator adds, such as a list's rows: placed
	 * without Builder formulas, and shared by every instance.
	 */
	const elementShape = (entity: AnyEntity, at: Path): string => {
		if (!drafts.has(entity.name)) place(entity.name, entity, {}, at, undefined);
		return entity.name;
	};

	/** The entities a member type may hold: the entity, a trait's implementers, or each of `t.oneOf` and `t.all`. */
	const allowed = (member: ResolvedMember): AnyEntity[] => {
		switch (member["~kind"]) {
			case "entity":
				return [member];
			case "trait":
				return spec.entities.filter((e) => implementsTrait(e, member.name));
			case "traitInitial":
				return allowed(member["~trait"]);
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
		holder: Holder,
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
		parts.push({ path: at, node: n as Record<string, unknown> });
		place(id, entity, n as Node, at, holder);
		return id;
	};

	/** Builds the shape for one placement of `entity`, and those of everything placed in it. */
	const place = (
		id: string,
		entity: AnyEntity,
		node: Node,
		at: Path,
		holder: Holder | undefined,
	): void => {
		const def = membersOf(entity);
		const inputs: Record<string, InputPlan> = {};
		const placed: Record<string, PlacedPlan> = {};
		const values: Record<string, ValuePlan> = {};
		const traits: Record<string, TraitPlan> = {};
		const outer = holder && drafts.get(holder.shape);
		checkMeta(node, at);
		const draft: Draft = {
			shape: {
				id,
				entity: entity.name,
				...(node.meta === undefined ? {} : { meta: node.meta }),
				inputs,
				values,
				placed,
				traits,
			},
			formulas: [],
			valueNames: new Set(),
			traitValues: new Map(),
			holder,
			top: outer ? outer.top : id,
			segments: outer
				? [...outer.segments, ...at.slice(outer.at.length).map(String)]
				: [],
			at,
			types: new Map(),
			traitTypes: new Map(),
		};
		const seeds: Record<string, unknown> = entity["~def"].seeds ?? {};
		const formula = (
			name: string,
			expr: unknown,
			builder: boolean,
			expect?: TypeSpec,
		): void => {
			draft.valueNames.add(name);
			const f: Formula = {
				expr,
				at,
				field: name,
				builder,
				suffix: [name],
				...(seeds[name] === undefined ? {} : { seed: seeds[name] }),
				...(expect ? { expect } : {}),
				put: (v) => {
					values[name] = v;
				},
			};
			draft.formulas.push(f);
			draft.types.set(name, () =>
				expect ? fromSpec(expect) : compileFormula(id, f),
			);
		};
		/** A value the Builder gave as JSON, decoded as the member's type. */
		const givenValue = (
			name: string,
			spec: TypeSpec,
			json: Json,
		): ValuePlan => {
			const r = decode(typePlan(spec), json, []);
			if (!r.ok) {
				report({
					code: "type.mismatch",
					message: `${JSON.stringify(json)} isn't ${fromSpec(spec).base === "int" ? "an int" : `a ${spec.name ?? spec.base}`}`,
					at,
					field: name,
				});
			}
			draft.types.set(name, () => fromSpec(spec));
			const check = checkOf(spec.checks);
			for (const issue of r.ok && check ? check(r.value) : []) {
				report({
					code: "check.failed",
					message: issue.message,
					at,
					field: name,
					data: { path: issue.path },
				});
			}
			return {
				...constant(json, r.ok ? r : fail(r.error.code, r.error.message)),
				...(check ? { check } : {}),
			};
		};
		/** An input's initial value from the Builder, if it fits; otherwise the kit's. */
		const initial = (name: string, spec: TypeSpec, fallback: Json): Json => {
			draft.types.set(name, () => fromSpec(spec));
			const override = node.inputs?.[name];
			if (override === undefined) return fallback;
			if (decode(typePlan(spec), toJson(override), []).ok)
				return toJson(override);
			report({
				code: "type.mismatch",
				message: `${JSON.stringify(override)} isn't a ${spec.name ?? spec.base}`,
				at,
				field: name,
			});
			return fallback;
		};
		// Reserve the id first, so an entity that holds its own kind doesn't recurse forever.
		drafts.set(id, draft);

		// What the tree gives that the kit no longer has, as after a breaking change.
		for (const part of ["config", "inputs"] as const) {
			for (const name of Object.keys(node[part] ?? {})) {
				if (!(name in def[part])) {
					report({
						code: part === "config" ? "config.unknown" : "input.unknown",
						message: `${entity.name} has no ${part === "config" ? "config" : "input"} "${name}"`,
						at,
						field: name,
					});
				}
			}
		}

		/** The enums the Builder defines in this node's config, by member. */
		const enums = new Map<string, BuilderEnum>();
		const builderEnum = (name: string): BuilderEnum => {
			let found = enums.get(name);
			if (!found) {
				found = readEnum(def.config[name], node.config?.[name], at, name);
				enums.set(name, found);
			}
			return found;
		};
		/** An input's type, with the values of the Builder's enum it takes them from. */
		const inputType = (
			spec: TypeSpec,
		): { spec: TypeSpec; type: ValueTypePlan; check?: Check } => {
			if (spec.from === undefined) {
				return { spec, type: typePlan(spec), ...checks(spec) };
			}
			const { values, meta } = builderEnum(spec.from);
			const full: TypeSpec = { ...spec, values };
			const schemas = checkOf(spec.checks);
			return {
				spec: full,
				type: { ...typePlan(full), open: true, ...(meta ? { meta } : {}) },
				// A value the Builder has since removed is kept, as an issue.
				check: (v) => [
					...(typeof v === "string" && !values.includes(v)
						? [
								{
									message: `enum.unknown: "${v}" is no longer one of the values`,
									path: [],
								},
							]
						: []),
					...(schemas?.(v) ?? []),
				],
			};
		};

		for (const [name, member] of Object.entries(def.inputs)) {
			const override = node.inputs?.[name];
			if (member["~kind"] === "initial") {
				const { spec, ...type } = inputType(member.type.spec);
				inputs[name] = {
					kind: "value",
					...type,
					initial: initial(name, spec, toJson(member.value)),
				};
			} else if (member["~kind"] === "value") {
				const { spec, ...type } = inputType(member.spec);
				inputs[name] = {
					kind: "value",
					...type,
					initial: initial(name, spec, null),
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
				place(
					`${id}/${name}`,
					member,
					asRecord(override) ?? {},
					[...at, name],
					{ shape: id, up: 1 },
				);
				placed[name] = { kind: "entity", shape: `${id}/${name}` };
			} else if (member["~kind"] === "traitInitial") {
				const options: Record<string, string> = {};
				for (const option of allowed(member)) {
					options[option.name] = elementShape(option, [...at, name]);
				}
				const chosen = asRecord(override)?.type ?? member["~entity"].name;
				if (typeof chosen === "string" && chosen in options) {
					inputs[name] = { kind: "choice", options, initial: chosen };
				} else {
					report({
						code: "node.type",
						message: `"${name}" can't start as ${JSON.stringify(chosen)}; it takes ${Object.keys(options).join(", ")}`,
						at,
						field: name,
					});
					inputs[name] = {
						kind: "choice",
						options,
						initial: member["~entity"].name,
					};
				}
			} else {
				unsupported(at, name, "this kind of input");
			}
		}

		for (const [name, declared] of Object.entries(def.config)) {
			let member = declared;
			const given = node.config?.[name];
			if (member["~kind"] === "optional") {
				const inner = resolveMember(member["~of"]);
				if (given === undefined) {
					// Left out: it reads as null.
					values[name] = constant(null, ok(null));
					const spec =
						inner["~kind"] === "expr"
							? inner.type.spec
							: inner["~kind"] === "value"
								? inner.spec
								: undefined;
					draft.types.set(name, () => (spec ? nullable(fromSpec(spec)) : ANY));
					continue;
				}
				member = inner;
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
					formula(name, given ?? null, true, member.type.spec);
					break;
				case "value":
					if (given === undefined) {
						report({
							code: "config.missing",
							message: `"${name}" needs a value`,
							at,
							field: name,
						});
					}
					values[name] = givenValue(name, member.spec, toJson(given ?? null));
					break;
				case "enumDef":
					if (given === undefined) {
						report({
							code: "config.missing",
							message: `"${name}" needs an enum: a list of values, or the name of one of the kit's`,
							at,
							field: name,
						});
					} else builderEnum(name);
					break;
				case "map":
				case "list":
					placed[name] = placeAll(
						member["~kind"],
						resolveMember(member["~of"]),
						given,
						`${id}/${name}`,
						[...at, name],
						id,
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
					const shape = placeNode(
						member,
						given,
						`${id}/${name}`,
						[...at, name],
						{ shape: id, up: 1 },
					);
					if (shape) placed[name] = { kind: "entity", shape };
					break;
				}
				default:
					unsupported(at, name, "this kind of config");
			}
		}

		for (const [name, expr] of Object.entries(def.derived)) {
			formula(name, expr, false);
		}

		// Each impl is computed in the entity's own scope, like a derived value.
		for (const [trait, impl] of Object.entries(def.impls)) {
			const values: Record<string, ValuePlan> = {};
			const aliases: Record<string, Address> = {};
			const names = new Set<string>();
			traits[trait] = { values, aliases };
			draft.traitValues.set(trait, names);
			const types = new Map<string, StaticType>();
			draft.traitTypes.set(trait, types);
			for (const [name, type] of Object.entries(impl.types)) {
				const expr = impl.body[name];
				if (memberKind(type) !== "value") {
					// kit() made sure it is e.self(member).
					aliases[name] = [(expr as readonly [string, string])[1]];
					continue;
				}
				names.add(name);
				const expect = type["~kind"] === "value" ? type.spec : undefined;
				types.set(name, expect ? fromSpec(expect) : ANY);
				draft.formulas.push({
					expr,
					at,
					field: `${trait}.${name}`,
					builder: false,
					suffix: [traitSegment(trait), name],
					...(expect ? { expect } : {}),
					put: (v) => {
						values[name] = v;
					},
				});
			}
		}
	};

	/** The elements the Builder placed in a config map or list. */
	const placeAll = (
		kind: "map" | "list",
		member: ResolvedMember,
		given: unknown,
		id: string,
		at: Path,
		holder: string,
	): PlacedPlan => {
		const elements: Placed[] = [];
		// A map's elements see each other as siblings; the array fills up as they are placed.
		const around: Holder =
			kind === "map"
				? { shape: holder, up: 2, siblings: elements }
				: { shape: holder, up: 2 };
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
				const shape = placeNode(
					member,
					node,
					`${id}/${key}`,
					[...at, key],
					around,
				);
				if (shape) elements.push({ id: key, shape });
			}
		} else {
			const nodes = Array.isArray(given) ? given : [];
			nodes.forEach((node, i) => {
				const shape = placeNode(member, node, `${id}/${i}`, [...at, i], around);
				if (shape) elements.push({ id: String(i), shape });
			});
		}
		return { kind, elements };
	};

	/** Checks a node's meta, or an enum value's, against the kit's `meta` schema, when it has both. */
	function checkMeta(node: Node, at: Path, field?: string): void {
		if (!spec.meta || node.meta === undefined) return;
		for (const issue of validate(spec.meta, node.meta)) {
			report({
				code: "meta.invalid",
				message: issue.message,
				at,
				...(field === undefined ? {} : { field }),
				data: { path: issue.path },
			});
		}
	}

	/**
	 * The enum a `t.enum.def()` config member holds: the values the Builder
	 * lists, each with its meta, or one of the kit's enums by name.
	 */
	function readEnum(
		declared: unknown,
		given: unknown,
		at: Path,
		field: string,
	): BuilderEnum {
		const invalid = (message: string): BuilderEnum => {
			report({ code: "enum.invalid", message, at, field });
			return { values: [] };
		};
		if (
			(declared as { "~kind"?: string } | undefined)?.["~kind"] !== "enumDef"
		) {
			return invalid(`"${field}" isn't a config member made by t.enum.def()`);
		}
		if (given === undefined) return { values: [] };
		if (typeof given === "string") {
			const found = Object.entries(spec.types ?? {}).find(([key, type]) => {
				const s = (type as { spec?: TypeSpec }).spec;
				return s?.base === "enum" && (key === given || s.name === given);
			});
			const values = (found?.[1] as { spec: TypeSpec } | undefined)?.spec
				.values;
			return values
				? { values }
				: invalid(`the kit has no enum ${JSON.stringify(given)}`);
		}
		const list = asRecord(given)?.enum;
		if (!Array.isArray(list)) {
			return invalid(
				"an enum is { enum: [{ value, meta }, …] }, or the name of one of the kit's",
			);
		}
		const values: string[] = [];
		const meta: Record<string, Json> = {};
		for (const option of list) {
			const o = asRecord(option);
			const value = o?.value;
			if (typeof value !== "string" || value === "") {
				invalid("each value of an enum is a text that isn't empty");
			} else if (values.includes(value)) {
				invalid(`"${value}" is in the enum twice`);
			} else {
				values.push(value);
				if (o?.meta !== undefined) {
					meta[value] = o.meta as Json;
					checkMeta({ meta: o.meta as Json }, at, field);
				}
			}
		}
		return Object.keys(meta).length > 0 ? { values, meta } : { values };
	}

	const unsupported = (at: Path, field: string, what: string): void => {
		report({
			code: "skeleton.unsupported",
			message: `${what} isn't supported yet`,
			at,
			field,
		});
	};

	place("$root", spec.root, (asRecord(tree) ?? {}) as Node, [], undefined);

	const none = new Set<string>();
	const compiler: Compiler = {
		functions: withBuilderFunctions(
			spec.functions ?? {},
			asRecord(tree)?.functions,
			report,
		),
		shapes: {
			root: "$root",
			get: (id) => drafts.get(id)?.shape,
			valueNames: (id) => {
				const draft = drafts.get(id);
				return draft
					? new Set([...draft.valueNames, ...Object.keys(draft.shape.values)])
					: none;
			},
			trait: (id, trait) => {
				const draft = drafts.get(id);
				const plan = draft?.shape.traits[trait];
				return plan && draft
					? {
							values: draft.traitValues.get(trait) ?? none,
							aliases: plan.aliases,
						}
					: undefined;
			},
			holder: (id) => drafts.get(id)?.holder,
		},
		type: ({ shape, name, trait }) => {
			const draft = drafts.get(shape);
			if (!draft) return ANY;
			if (trait !== undefined) {
				return draft.traitTypes.get(trait)?.get(name) ?? ANY;
			}
			return draft.types.get(name)?.() ?? ANY;
		},
		expression: ({ shape, name, trait }) => {
			const suffix = trait === undefined ? [name] : [traitSegment(trait), name];
			const f = drafts
				.get(shape)
				?.formulas.find((f) => f.suffix.join("/") === suffix.join("/"));
			return f && { expr: f.expr, builder: f.builder };
		},
		report,
	};
	/** Compiles a formula once, and gives its value's type. */
	function compileFormula(shape: string, f: Formula): StaticType {
		if (f.compiled) return f.compiled.type;
		// Two values whose types need each other: the checker can't know more here.
		if (f.busy) return ANY;
		f.busy = true;
		const scope = {
			shape,
			at: f.at,
			field: f.field,
			builder: f.builder,
			...(f.expect ? { expect: f.expect } : {}),
		};
		const compiled = compile(f.expr, scope, compiler);
		const check = f.expect && checkOf(f.expect.checks);
		f.compiled = check
			? { ...compiled, plan: { ...compiled.plan, check } }
			: compiled;
		f.busy = false;
		f.put(f.compiled.plan);
		return f.compiled.type;
	}
	for (const { shape, formulas } of drafts.values()) {
		for (const f of formulas) compileFormula(shape.id, f);
	}

	const nodes: ValueNode[] = [];
	for (const { shape, formulas } of drafts.values()) {
		for (const f of formulas) {
			const { plan, type } = f.compiled as Compiled;
			nodes.push({
				shape: shape.id,
				suffix: f.suffix,
				plan,
				type,
				...(f.seed === undefined ? {} : { seed: f.seed }),
				put: f.put,
			});
		}
	}
	markCycles(nodes, (id) => drafts.get(id));

	const shapes = new Map<string, Shape>();
	for (const [id, { shape }] of drafts) shapes.set(id, shape);
	return { plan: { root: "$root", shapes }, diagnostics, parts };
}

function constant(expr: Json, value: Result<unknown>): ValuePlan {
	return { expr, refs: [], compute: () => value };
}

/** The `check` of a plan for a value of this type, when the type has checks. */
function checks(spec: TypeSpec): { check?: Check } {
	const check = checkOf(spec.checks);
	return check ? { check } : {};
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
