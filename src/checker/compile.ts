import { type ExprArg, jsonOf, type KitFn } from "../kit";
import type { Fold, Ref, ValuePlan } from "../plan";
import { fail, type Json, ok, type Path, type Result } from "../values";
import { invoke } from "./call";
import { type Resolved, resolveRef, type Shapes } from "./paths";
import type { Diagnostic } from "./types";

/** Where an expression sits, for its references and its diagnostics. */
export interface Scope {
	/** The shape of the instance the expression is evaluated in. */
	readonly shape: string;
	readonly at: Path;
	readonly field: string;
	/** Whether a Builder wrote it, so its paths see the Builder's scope; see {@link resolveRef}. */
	readonly builder: boolean;
}

/** What compiling needs from the program being checked. */
export interface Compiler {
	readonly functions: Readonly<Record<string, KitFn>>;
	readonly shapes: Shapes;
	report(diagnostic: Diagnostic): void;
}

/** Computes a value from the values of the expression's references. */
type Eval = (args: readonly unknown[]) => Result<unknown>;

/** An id per aggregate, so two folds over one list stay apart. */
const aggregateIds = new WeakMap<object, number>();

/**
 * Compiles one expression into the references it makes and a closure over
 * their values. A mistake becomes a diagnostic, and the part of the
 * expression it is in computes to that error.
 */
export function compile(
	expr: ExprArg,
	scope: Scope,
	compiler: Compiler,
): ValuePlan {
	const refs: Ref[] = [];
	const keys: string[] = [];
	const refIndex = (ref: Ref): number => {
		const key = JSON.stringify(ref, (k, v) =>
			k === "aggregate" ? aggregateId(v) : v,
		);
		const found = keys.indexOf(key);
		if (found >= 0) return found;
		keys.push(key);
		return refs.push(ref) - 1;
	};
	const broken = (
		code: string,
		message: string,
		exprPath: number[],
		data?: unknown,
	) => {
		compiler.report({
			code,
			message,
			at: scope.at,
			field: scope.field,
			exprPath,
			...(data === undefined ? {} : { data }),
		});
		const error = fail(code, message);
		return () => error;
	};

	/**
	 * Resolves a path in this expression's scope, warning when an own member
	 * hides a sibling. A `probe`, for an aggregate's argument, warns only for
	 * a list: any other argument is compiled as a value, which warns then.
	 */
	const resolve = (
		path: readonly unknown[],
		at: number[],
		probe = false,
	): Resolved => {
		const { resolved, shadowed } = resolveRef(path, scope, compiler.shapes);
		if (shadowed !== undefined && !(probe && resolved.kind !== "list")) {
			compiler.report({
				code: "scope.shadowed",
				severity: "warning",
				message: `"${shadowed}" is the entity's own member, which hides the sibling of the same name`,
				at: scope.at,
				field: scope.field,
				exprPath: at,
			});
		}
		return resolved;
	};

	/** The bodies being inlined, innermost last, to catch a function calling itself. */
	const inlining: string[] = [];
	const node = (x: ExprArg, path: number[]): Eval => {
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
		const [name, ...rest] = x as readonly [string, ...ExprArg[]];
		if (name === "text") {
			const value = ok(rest[0]);
			return () => value;
		}
		if (name === "error") {
			// What a parser hands over for text it couldn't parse; `data` comes back on the diagnostic.
			const { message = "this expression has an error", data } = (rest[0] ??
				{}) as { message?: string; data?: unknown };
			return broken("expr.error", message, path, data);
		}
		if (name === "ref") {
			if (rest.length === 1 && (rest[0] === "$index" || rest[0] === "$key")) {
				const i = refIndex({
					kind: "place",
					of: rest[0] === "$index" ? "index" : "key",
				});
				return (args) => ok(args[i]);
			}
			const resolved = resolve(rest, path);
			if (resolved.kind === "error") {
				return broken(resolved.code, resolved.message, path);
			}
			if (resolved.kind === "list") {
				return broken(
					"ref.list",
					`${JSON.stringify(rest)} goes through "$each", so it is a list: pass it to an aggregate such as sum`,
					path,
				);
			}
			const i = refIndex(resolved.ref);
			return (args) => ok(args[i]);
		}
		const f = compiler.functions[name];
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
			// The names match, so every parameter has its argument.
			args = Object.keys(signature.params).map((k) => named[k] ?? null);
		}
		// An aggregate takes one list, or any number of values.
		const fitting = f.signatures.filter((s) =>
			s.aggregate
				? args.length > 0
				: Object.keys(s.params).length === args.length,
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
			const list =
				args.length === 1 && isRef(args[0])
					? resolve(args[0].slice(1), [...path, 1], true)
					: undefined;
			if (list?.kind === "list") {
				const i = refIndex({
					kind: "fold",
					list: list.list,
					each: list.each,
					aggregate: first.aggregate,
					...(list.up === undefined ? {} : { up: list.up }),
				});
				return (values) => ok(values[i]);
			}
			// Values given one by one, as in ["sum", ["ref", "q1"], ["ref", "q2"]].
			const fold: Fold = first.aggregate;
			const compiled = args.map((arg, i) => node(arg, [...path, i + 1]));
			return (values) => {
				let acc = fold.init();
				for (const arg of compiled) {
					const r = arg(values);
					if (!r.ok) {
						if (fold.skipErrors) continue;
						return r;
					}
					acc = fold.add(acc, r.value);
				}
				return ok(fold.result(acc));
			};
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
				return node(jsonOf(first.body(params)), path);
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
}

function aggregateId(aggregate: object): number {
	let id = aggregateIds.get(aggregate);
	if (id === undefined) {
		id = nextAggregateId++;
		aggregateIds.set(aggregate, id);
	}
	return id;
}
let nextAggregateId = 0;

/** `["ref", …]`, as an aggregate's argument. */
function isRef(x: ExprArg | undefined): x is readonly ["ref", ...ExprArg[]] {
	return Array.isArray(x) && x[0] === "ref";
}

/** A plain object, such as named arguments; not an array or `null`. */
function asRecord(
	x: ExprArg | undefined,
): Readonly<Record<string, ExprArg>> | undefined {
	return typeof x === "object" && x !== null && !Array.isArray(x)
		? (x as Readonly<Record<string, ExprArg>>)
		: undefined;
}

/** A value as JSON: a decimal through its `toJSON`, everything else as is. */
export function toJson(value: unknown): Json {
	return JSON.parse(JSON.stringify(value ?? null)) as Json;
}
