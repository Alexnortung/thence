import {
	type AnyEntity,
	type KitSpec,
	membersOf,
	resolveMember,
	type TypeSpec,
} from "../kit";
import type { InputPlan, Ref, Shape, ValuePlan, ValueTypePlan } from "../plan";
import { fail, type Json, ok, type Path, type Result } from "../values";
import { invoke } from "./call";
import type { Checked, Diagnostic } from "./types";

/** The parts of a Builder's tree the skeleton reads. */
interface PlacementTree {
	readonly config?: Readonly<Record<string, unknown>>;
	readonly inputs?: Readonly<Record<string, unknown>>;
}

/**
 * Checks a Builder's tree against a kit and compiles it. A mistake becomes a
 * diagnostic, and the value it breaks computes to an error, so the rest of
 * the program still runs.
 */
export function check(spec: KitSpec, tree: unknown): Checked {
	const diagnostics: Diagnostic[] = [];
	const shapes = new Map<string, Shape>();
	const functions = spec.functions ?? {};

	/** The shape for an entity placed without Builder formulas, such as a list's rows. */
	const shapeOf = (entity: AnyEntity): string => {
		if (!shapes.has(entity.name)) build(entity.name, entity, {}, []);
		return entity.name;
	};

	const build = (
		id: string,
		entity: AnyEntity,
		placement: PlacementTree,
		at: Path,
	): void => {
		const def = membersOf(entity);
		const inputs: Record<string, InputPlan> = {};
		const exprs: Record<string, { expr: unknown; field: string }> = {};
		const constants: Record<string, Json> = {};
		// Reserve the id first, so a list of its own entity doesn't recurse forever.
		const shape: Shape = { id, entity: entity.name, inputs, values: {} };
		shapes.set(id, shape);

		for (const [name, member] of Object.entries(def.inputs)) {
			const override = placement.inputs?.[name];
			const element =
				member["~kind"] === "list" ? resolveMember(member["~of"]) : undefined;
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
			} else if (element?.["~kind"] === "entity") {
				inputs[name] = { kind: "list", of: shapeOf(element) };
			} else {
				unsupported(at, name, "this kind of input");
			}
		}

		for (const [name, member] of Object.entries(def.config)) {
			const given = placement.config?.[name];
			if (member["~kind"] === "expr") {
				if (given === undefined) {
					diagnostics.push({
						code: "config.missing",
						message: `"${name}" needs a formula`,
						at,
						field: name,
					});
				}
				exprs[name] = { expr: given ?? null, field: name };
			} else if (member["~kind"] === "value") {
				constants[name] = toJson(given ?? null);
			} else {
				unsupported(at, name, "this kind of config");
			}
		}

		for (const [name, expr] of Object.entries(def.derived)) {
			exprs[name] = { expr, field: name };
		}

		const names = new Set([
			...Object.keys(inputs),
			...Object.keys(exprs),
			...Object.keys(constants),
		]);
		const values: Record<string, ValuePlan> = {};
		for (const [name, value] of Object.entries(constants)) {
			values[name] = { expr: value, refs: [], compute: () => ok(value) };
		}
		for (const [name, { expr, field }] of Object.entries(exprs)) {
			values[name] = compile(expr, { at, field, names, inputs });
		}
		shapes.set(id, { ...shape, values });
	};

	interface Scope {
		readonly at: Path;
		readonly field: string;
		readonly names: ReadonlySet<string>;
		readonly inputs: Readonly<Record<string, InputPlan>>;
	}

	/** Compiles one expression into the references it makes and a closure over their values. */
	const compile = (expr: unknown, scope: Scope): ValuePlan => {
		const refs: Ref[] = [];
		const keys: string[] = [];
		const refIndex = (ref: Ref): number => {
			const key = JSON.stringify(ref, (k, v) =>
				k === "aggregate" ? undefined : v,
			);
			const found = keys.indexOf(key);
			if (found >= 0) return found;
			keys.push(key);
			return refs.push(ref) - 1;
		};
		const broken = (code: string, message: string, exprPath: number[]) => {
			diagnostics.push({
				code,
				message,
				at: scope.at,
				field: scope.field,
				exprPath,
			});
			const error = fail(code, message);
			return () => error;
		};

		type Eval = (args: readonly unknown[]) => Result<unknown>;
		/** The bodies being inlined, innermost last, to catch a function calling itself. */
		const inlining: string[] = [];
		const node = (x: unknown, path: number[]): Eval => {
			if (typeof x === "number" || typeof x === "boolean" || x === null) {
				const value = ok(x);
				return () => value;
			}
			if (!Array.isArray(x) || typeof x[0] !== "string") {
				return broken(
					"expr.invalid",
					"an expression is a JSON array with a name first, or a number, boolean or null",
					path,
				);
			}
			const [name, ...rest] = x as [string, ...unknown[]];
			if (name === "text") {
				const value = ok(rest[0]);
				return () => value;
			}
			if (name === "error") {
				const { message = "this expression has an error" } = (rest[0] ??
					{}) as { message?: string };
				return broken("expr.error", message, path);
			}
			if (name === "ref") {
				if (
					rest.length === 1 &&
					typeof rest[0] === "string" &&
					scope.names.has(rest[0])
				) {
					const i = refIndex({ kind: "member", name: rest[0] });
					return (args) => ok(args[i]);
				}
				return broken(
					"ref.unknown",
					`nothing at ${JSON.stringify(rest)} here`,
					path,
				);
			}
			const f = functions[name];
			if (!f) {
				return broken("fn.unknown", `the kit has no function "${name}"`, path);
			}
			// Named arguments, as `e.call` writes them, are one object.
			let args = rest;
			const named = rest.length === 1 ? asRecord(rest[0]) : undefined;
			if (named) {
				const keys = Object.keys(named).sort().join();
				const signature = f.signatures.find(
					(s) => Object.keys(s.params).sort().join() === keys,
				);
				if (!signature) {
					return broken(
						"call.args",
						`"${name}" has no parameters named ${Object.keys(named).join(", ")}`,
						path,
					);
				}
				args = Object.keys(signature.params).map((k) => named[k]);
			}
			const fitting = f.signatures.filter(
				(s) => Object.keys(s.params).length === args.length,
			);
			const first = fitting[0];
			if (!first) {
				return broken(
					"call.arity",
					`"${name}" doesn't take ${args.length} argument${args.length === 1 ? "" : "s"}`,
					path,
				);
			}
			if (first.aggregate) {
				const each = eachRef(args[0], scope);
				if (!each) {
					return broken(
						"ref.unknown",
						`"${name}" needs a list, such as ["ref", "rows", "$each", "amount"]`,
						[...path, 1],
					);
				}
				const i = refIndex({
					kind: "fold",
					...each,
					aggregate: first.aggregate,
				});
				return (values) => ok(values[i]);
			}
			if (first.body) {
				// A body is inlined: the arguments' expressions take the parameters' places.
				if (inlining.includes(name)) {
					return broken("fn.recursive", `"${name}" calls itself`, path);
				}
				const params = Object.fromEntries(
					Object.keys(first.params).map((k, i) => [k, args[i]]),
				);
				inlining.push(name);
				try {
					return node(first.body(params), path);
				} finally {
					inlining.pop();
				}
			}
			const compiled = args.map((arg, i) => node(arg, [...path, i + 1]));
			return (values) => {
				const evaluated: unknown[] = [];
				for (const arg of compiled) {
					const r = arg(values);
					if (!r.ok) return r;
					evaluated.push(r.value);
				}
				return invoke(f, evaluated);
			};
		};

		const root = node(expr, []);
		return { expr: toJson(expr), refs, compute: root };
	};

	/** `["ref", list, "$each", member]` on a list input of this entity, or undefined. */
	const eachRef = (
		x: unknown,
		scope: Scope,
	): { list: string; member: string } | undefined => {
		if (!Array.isArray(x) || x.length !== 4) return undefined;
		const [ref, list, each, member] = x as unknown[];
		if (ref !== "ref" || each !== "$each" || typeof list !== "string")
			return undefined;
		if (typeof member !== "string") return undefined;
		const input = scope.inputs[list];
		if (input?.kind !== "list") return undefined;
		const element = shapes.get(input.of);
		const known =
			element !== undefined &&
			(member in element.inputs || member in element.values);
		return known ? { list, member } : undefined;
	};

	const unsupported = (at: Path, field: string, what: string): void => {
		diagnostics.push({
			code: "skeleton.unsupported",
			message: `${what} isn't supported yet`,
			at,
			field,
		});
	};

	build("$root", spec.root, (tree ?? {}) as PlacementTree, []);
	return { plan: { root: "$root", shapes }, diagnostics };
}

/** A plain object, such as named arguments; not an array or `null`. */
function asRecord(x: unknown): Record<string, unknown> | undefined {
	return typeof x === "object" && x !== null && !Array.isArray(x)
		? (x as Record<string, unknown>)
		: undefined;
}

function typePlan(spec: TypeSpec): ValueTypePlan {
	return {
		base: spec.base,
		nullable: spec.nullable,
		...(spec.scale === undefined ? {} : { scale: spec.scale }),
		...(spec.values === undefined ? {} : { values: spec.values }),
	};
}

/** A value as JSON: a decimal through its `toJSON`, everything else as is. */
function toJson(value: unknown): Json {
	return JSON.parse(JSON.stringify(value ?? null)) as Json;
}
