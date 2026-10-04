import {
	type ExprArg,
	type FnSpec,
	jsonOf,
	type KitFn,
	type ParamType,
	paramList,
	type TypeSpec,
	type ValueType,
} from "../kit";
import {
	type Fold,
	type Inverse,
	type Ref,
	toJson,
	type ValuePlan,
} from "../plan";
import { Decimal, fail, ok, type Path, type Result } from "../values";
import { invert, invoke, invokeSignature } from "./call";
import { type Owner, type Resolved, resolveRef, type Shapes } from "./paths";
import type { Diagnostic } from "./types";
import {
	ANY,
	coerces,
	describe,
	type Fit,
	fitsParam,
	fromSpec,
	join,
	misfit,
	NULL,
	nullable,
	paramSpec,
	type StaticType,
	widen,
} from "./typing";

/** Where an expression sits, for its references and its diagnostics. */
export interface Scope {
	/** The shape of the instance the expression is evaluated in. */
	readonly shape: string;
	readonly at: Path;
	readonly field: string;
	/** Whether a Builder wrote it, so its paths see the Builder's scope; see {@link resolveRef}. */
	readonly builder: boolean;
	/**
	 * The type declared where it goes, such as a config field's
	 * `t.expr(Money)` or a trait's member. A number literal becomes a value
	 * of that type, and anything else must fit it.
	 */
	readonly expect?: TypeSpec;
}

/** A compiled expression, and the type of its value. */
export interface Compiled {
	readonly plan: ValuePlan;
	/** The declared type when there is one, otherwise what the checker worked out. */
	readonly type: StaticType;
}

/** What compiling needs from the program being checked. */
export interface Compiler {
	readonly functions: Readonly<Record<string, KitFn>>;
	readonly shapes: Shapes;
	/** The type of a member a path ends at. */
	type(owner: Owner): StaticType;
	report(diagnostic: Diagnostic): void;
}

/**
 * Computes a value from the values of the expression's references, with
 * the value's type and, when its expression can be worked back, its
 * {@link ValuePlan.inverse}.
 */
type Eval = ((args: readonly unknown[]) => Result<unknown>) & {
	type: StaticType;
	inverse?: ValuePlan["inverse"];
};

function typed(
	compute: (args: readonly unknown[]) => Result<unknown>,
	type: StaticType,
	inverse?: NonNullable<ValuePlan["inverse"]>,
): Eval {
	return Object.assign(compute, inverse ? { type, inverse } : { type });
}

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
): Compiled {
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
	const broken = (code: string, message: string, exprPath: number[]) => {
		compiler.report({
			code,
			message,
			at: scope.at,
			field: scope.field,
			exprPath,
		});
		const error = fail(code, message);
		return typed(() => error, ANY);
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
			const type: StaticType =
				typeof x === "number"
					? { base: "number", nullable: false, literal: x }
					: typeof x === "boolean"
						? { base: "bool", nullable: false }
						: NULL;
			return typed(() => value, type);
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
			return typed(() => value, { base: "text", nullable: false });
		}
		if (name === "error") {
			const { message = "this expression has an error" } = (rest[0] ?? {}) as {
				message?: string;
			};
			return broken("expr.error", message, path);
		}
		if (name === "ref") {
			if (rest.length === 1 && (rest[0] === "$index" || rest[0] === "$key")) {
				const index = rest[0] === "$index";
				const i = refIndex({ kind: "place", of: index ? "index" : "key" });
				// `null` outside a list, or a map.
				const type: StaticType = {
					base: index ? "int" : "text",
					nullable: true,
				};
				return typed((args) => ok(args[i]), type);
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
			const through: Inverse = { ref: i, value: (target) => ok(target) };
			const type = join(resolved.owners.map((o) => compiler.type(o)));
			return typed(
				(args) => ok(args[i]),
				// A lookup is null when it finds nothing.
				resolved.ref.kind === "lookup" ? nullable(type) : type,
				(writable) => (writable(i) ? through : undefined),
			);
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
				(s) => namesOf(f, s).sort().join() === keys,
			);
			if (!signature) {
				return broken(
					"call.args",
					`"${name}" has no parameters named ${Object.keys(named).join(", ")}`,
					path,
				);
			}
			// The names match, so every parameter has its argument.
			args = namesOf(f, signature).map((k) => named[k] ?? null);
		}
		// An aggregate takes one list, or any number of values.
		const fitting = f.signatures.filter((s) =>
			s.aggregate ? args.length > 0 : s.params.length === args.length,
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
			const compiled =
				list?.kind === "list"
					? []
					: args.map((arg, i) => node(arg, [...path, i + 1]));
			const element =
				list?.kind === "list"
					? join(list.owners.map((o) => compiler.type(o)))
					: join(compiled.map((c) => c.type));
			const picked = pick(
				fitting.filter((s) => s.aggregate),
				// A fold skips empty values, so an element that may be null fits as it is.
				(s) => {
					const fit = fitsParam(paramSpec(firstParam(f, s)), element);
					return [fit === "nulls" ? "yes" : fit];
				},
			);
			if (picked === "none") {
				return broken(
					"call.types",
					`"${name}" doesn't take values of type ${describe(element)}`,
					path,
				);
			}
			const signature = picked === "maybe" ? first : picked;
			const type =
				picked === "maybe" ? ANY : returnType(f, signature, [element], false);
			const fold = signature.aggregate as Fold;
			// An empty sum of decimals is the number 0: give it the decimal's scale.
			const zero =
				type.base === "decimal"
					? (v: unknown) =>
							typeof v === "number" ? Decimal.from(v, type.scale ?? 0) : v
					: (v: unknown) => v;
			if (list?.kind === "list") {
				const i = refIndex({
					kind: "fold",
					list: list.list,
					each: list.each,
					aggregate: fold,
					...(list.up === undefined ? {} : { up: list.up }),
				});
				return typed((values) => ok(zero(values[i])), type);
			}
			// Values given one by one, as in ["sum", ["ref", "q1"], ["ref", "q2"]].
			return typed((values) => {
				let acc = fold.init();
				for (const arg of compiled) {
					const r = arg(values);
					if (!r.ok) {
						if (fold.skipErrors) continue;
						return r;
					}
					acc = fold.add(acc, r.value);
				}
				return ok(zero(fold.result(acc)));
			}, type);
		}
		if (first.body) {
			// A body is inlined: the arguments' expressions take the parameters' places.
			if (inlining.includes(name)) {
				return broken("fn.recursive", `"${name}" calls itself`, path);
			}
			const params = Object.fromEntries(
				namesOf(f, first).map((k, i) => [k, args[i]]),
			);
			inlining.push(name);
			try {
				return node(jsonOf(first.body(params)), path);
			} finally {
				inlining.pop();
			}
		}
		const compiled = args.map((arg, i) => node(arg, [...path, i + 1]));
		const types = compiled.map((c) => c.type);
		// The signature is picked here when the arguments' types say which fits.
		const picked = pick(
			f.signatures.filter((s) => s.impl && s.params.length === args.length),
			(s) =>
				paramList(f.name, s).map(([, p], i) =>
					fitsParam(paramSpec(p), types[i] as StaticType),
				),
		);
		if (picked === "none") {
			return broken(
				"call.types",
				`"${name}" doesn't take ${types.map(describe).join(", ")}`,
				path,
			);
		}
		const run =
			picked === "maybe"
				? (evaluated: unknown[]) => invoke(f, evaluated)
				: (evaluated: unknown[]) => invokeSignature(f, picked, evaluated);
		const type = picked === "maybe" ? ANY : returnType(f, picked, types, true);
		const call = (values: readonly unknown[]) => {
			const evaluated: unknown[] = [];
			for (const arg of compiled) {
				const r = arg(values);
				if (!r.ok) return r;
				evaluated.push(r.value);
			}
			return run(evaluated);
		};
		// Writable through the one argument that is, if its parameter has an inverse.
		const inverted = compiled.map((_, j) =>
			f.signatures.some((s) => {
				const name = namesOf(f, s)[j];
				return name !== undefined && s.inverse?.[name] !== undefined;
			}),
		);
		if (!inverted.includes(true)) return typed(call, type);
		return typed(call, type, (writable) => {
			const through = compiled.map((arg) => arg.inverse?.(writable));
			const writes = through.flatMap((t, j) => (t ? [j] : []));
			const j = writes.length === 1 ? (writes[0] as number) : -1;
			const inner = through[j];
			if (!inner || !inverted[j]) return undefined;
			return {
				ref: inner.ref,
				value: (target, values) => {
					// The argument written to only picks the signature, so it may be empty or failing.
					const evaluated: unknown[] = [];
					for (const [i, arg] of compiled.entries()) {
						const r = arg(values);
						if (!r.ok && i !== j) return r;
						evaluated.push(r.ok ? r.value : null);
					}
					const r = invert(f, j, evaluated, target);
					return r.ok ? inner.value(r.value, values) : r;
				},
			};
		});
	};

	let root = node(expr, []);
	const expect = scope.expect;
	if (expect) {
		const bad = misfit(expect, root.type);
		if (bad) root = broken(bad.code, bad.message, []);
		else if (coerces(expect, root.type) && expect.base === "decimal") {
			const value = ok(
				Decimal.from(root.type.literal as number, expect.scale ?? 0),
			);
			root = typed(() => value, fromSpec(expect));
		}
	}
	return {
		plan: {
			expr: toJson(expr),
			refs,
			compute: root,
			...(root.inverse ? { inverse: root.inverse } : {}),
		},
		type: expect ? fromSpec(expect) : root.type,
	};
}

/**
 * The first signature every argument fits; `maybe` when the checker can't
 * tell before one that surely fits, so the call picks at run time; `none`
 * when none fits. A signature that takes a `null` wins, so one whose
 * parameter only `nulls` fits is picked here only when no later signature
 * could take that `null`.
 */
function pick(
	signatures: readonly FnSpec[],
	fits: (s: FnSpec) => readonly Fit[],
): FnSpec | "maybe" | "none" {
	const each = signatures.map(fits);
	for (const [i, s] of signatures.entries()) {
		const own = each[i] as readonly Fit[];
		if (own.includes("no")) continue;
		if (own.includes("maybe")) return "maybe";
		const later = each
			.slice(i + 1)
			.some(
				(other) =>
					!other.includes("no") &&
					own.some((fit, k) => fit === "nulls" && other[k] !== "nulls"),
			);
		return later ? "maybe" : s;
	}
	return "none";
}

/**
 * What a signature returns for arguments of these types: its declared type,
 * or the type of the argument it names (for a list, the element's). With
 * `nulls`, as for an `impl`, an argument that may be null where its
 * parameter isn't makes the result nullable too.
 */
function returnType(
	f: KitFn,
	s: FnSpec,
	args: readonly StaticType[],
	nulls: boolean,
): StaticType {
	const params = paramList(f.name, s);
	const names = params.map(([name]) => name);
	let type: StaticType;
	if (typeof s.returns === "string") {
		const arg = args[names.indexOf(s.returns)];
		type =
			arg && arg.base !== "null" ? { ...widen(arg), nullable: false } : ANY;
	} else type = fromSpec((s.returns as ValueType<unknown>).spec);
	const nulled =
		nulls &&
		params.some(([, p], i) => args[i]?.nullable && !paramSpec(p).nullable);
	return nulled ? nullable(type) : type;
}

function firstParam(f: KitFn, s: FnSpec): ParamType {
	return paramList(f.name, s)[0]?.[1] as ParamType;
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

/** A signature's parameter names, in order. */
function namesOf(f: KitFn, signature: FnSpec): string[] {
	return paramList(f.name, signature).map(([name]) => name);
}

/** A plain object, such as named arguments; not an array or `null`. */
function asRecord(
	x: ExprArg | undefined,
): Readonly<Record<string, ExprArg>> | undefined {
	return typeof x === "object" && x !== null && !Array.isArray(x)
		? (x as Readonly<Record<string, ExprArg>>)
		: undefined;
}
