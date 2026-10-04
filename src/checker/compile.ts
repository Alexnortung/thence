import {
	type BuilderExpr,
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
	type Stage,
	toJson,
	type ValuePlan,
} from "../plan";
import {
	Decimal,
	FnError,
	fail,
	type Json,
	ok,
	type Path,
	type Result,
} from "../values";
import { invert, invoke, invokeSignature } from "./call";
import { type Followed, follow, refTo } from "./document";
import {
	type CollectionAt,
	type Inside,
	inScope,
	type Owner,
	placedElements,
	type Resolved,
	resolveCollection,
	resolveCollectionIn,
	resolveIn,
	resolveRef,
	type Shapes,
} from "./paths";
import type { Diagnostic } from "./types";
import {
	ANY,
	coerces,
	describe,
	type Fit,
	fitsParam,
	fromSpec,
	join,
	LIST,
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
	/** For a component's body: the body's root shape, which its paths can't step out of. */
	readonly sealed?: string;
	/** The parameters of the lambdas the expression is in, innermost last. */
	readonly params?: readonly Lambda[];
	/**
	 * Where the expression sits in the formula, for `exprPath`: the body of
	 * a lambda over a collection is compiled on its own.
	 */
	readonly base?: readonly number[];
}

/** A lambda's parameter, as its body reads it. */
export type Lambda =
	/** An element of a collection: a path from it is a reference marked `param`. */
	| {
			readonly name: string;
			readonly kind: "element";
			readonly shapes: readonly string[];
	  }
	/** What the `map` before it gave, over a collection: a `{ kind: "param" }` reference. */
	| { readonly name: string; readonly kind: "stage"; readonly type: StaticType }
	/** An item of a JSON array, set while the lambda runs. */
	| {
			readonly name: string;
			readonly kind: "item";
			readonly slot: { value: unknown };
			readonly type: StaticType;
	  }
	/**
	 * The parameter of a lambda around a lambda over a collection, whose
	 * body runs in a cell of its own, where that value isn't.
	 */
	| { readonly name: string; readonly kind: "outside" };

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
	/** The expression that computes a value, and whether a Builder wrote it; `undefined` for an input. */
	expression(
		owner: Owner,
	): { readonly expr: ExprArg; readonly builder: boolean } | undefined;
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
	/** For a JSON array made by `map` or `filter`: its items' type, so an aggregate folds the items. */
	items?: StaticType;
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
	const { refs, node, broken } = compiling(scope, compiler);
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
 * The ids of the elements a derived collection keeps: `expr` is a
 * collection, or `filter`s over one. When one of its lambdas has a
 * mistake, which is reported, the collection fails.
 */
export function compileMembers(
	expr: ExprArg,
	scope: Scope,
	compiler: Compiler,
): Extract<Ref, { kind: "fold" }> {
	const { chain } = compiling(scope, compiler);
	const found = chain(expr, []);
	if (found && !("error" in found)) return foldOf(found, COLLECT);
	const error = fail("derived.invalid", "this collection has an error");
	return {
		kind: "fold",
		list: [],
		each: [],
		aggregate: COLLECT,
		stages: [{ kind: "filter", refs: [], compute: () => error }],
	};
}

/** A `map` or `filter` over a collection: the collection, and the lambdas each element runs. */
interface Chain extends CollectionAt {
	readonly stages: readonly Stage[];
	/** Whether the collection's path starts at a lambda's element. */
	readonly param?: true;
	/** The type of what the last `map` gives; `undefined` without one, when each element gives its id. */
	readonly value?: StaticType;
}

/** The fold over a chain's elements, after their lambdas. */
function foldOf(chain: Chain, aggregate: Fold): Extract<Ref, { kind: "fold" }> {
	return {
		kind: "fold",
		list: chain.list,
		each: [],
		aggregate,
		stages: chain.stages,
		...(chain.up === undefined ? {} : { up: chain.up }),
		...(chain.param ? { param: true } : {}),
	};
}

/** The compiler of one expression: its references so far, and how each part compiles. */
function compiling(scope: Scope, compiler: Compiler) {
	const refs: Ref[] = [];
	const keys: string[] = [];
	const refIndex = (ref: Ref): number => {
		// Two folds over one list, or two lambdas that read the same, stay apart.
		const key = JSON.stringify(ref, (k, v) =>
			k === "aggregate" || k === "compute" ? aggregateId(v) : v,
		);
		const found = keys.indexOf(key);
		if (found >= 0) return found;
		keys.push(key);
		return refs.push(ref) - 1;
	};
	/** A position in the expression as a position in the formula. */
	const where = (exprPath: readonly number[]): number[] => [
		...(scope.base ?? []),
		...exprPath,
	];
	const broken = (code: string, message: string, exprPath: number[]) => {
		compiler.report({
			code,
			message,
			at: scope.at,
			field: scope.field,
			exprPath: where(exprPath),
		});
		const error = fail(code, message);
		return typed(() => error, ANY);
	};
	/** The lambdas' parameters in scope, innermost last. */
	const params: Lambda[] = [...(scope.params ?? [])];
	const paramNamed = (name: unknown): Lambda | undefined => {
		for (let i = params.length - 1; i >= 0; i--) {
			if (params[i]?.name === name) return params[i];
		}
		return undefined;
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
		const param = paramNamed(path[0]);
		if (param?.kind === "element") {
			const r = resolveIn(path.slice(1), param.shapes, compiler.shapes);
			return r.kind === "inside"
				? {
						kind: "error",
						code: "skeleton.unsupported",
						message:
							"a path from a lambda's parameter into a value isn't supported yet",
					}
				: r;
		}
		const { resolved, shadowed } = resolveRef(path, scope, compiler.shapes);
		if (shadowed !== undefined && !(probe && resolved.kind !== "list")) {
			compiler.report({
				code: "scope.shadowed",
				severity: "warning",
				message: `"${shadowed}" is the entity's own member, which hides the sibling of the same name`,
				at: scope.at,
				field: scope.field,
				exprPath: where(at),
			});
		}
		return resolved;
	};

	/**
	 * Resolves a path, following it into a value when it goes on inside one,
	 * as into your data document.
	 */
	const document = {
		resolve: (p: readonly unknown[]) =>
			resolveRef(p, scope, compiler.shapes).resolved,
		expression: (owner: Owner) => compiler.expression(owner),
		elements: (p: readonly unknown[]) =>
			placedElements(p, scope, compiler.shapes),
	};
	const resolveInto = (
		path: readonly unknown[],
		at: number[],
		probe = false,
	):
		| Exclude<Resolved, Inside>
		| Exclude<Followed, { kind: "error" } | { kind: "whole" }>
		| { kind: "whole"; inside: Inside } => {
		const resolved = resolve(path, at, probe);
		if (resolved.kind !== "inside") return resolved;
		const f = follow(resolved, document);
		if (f.kind === "whole") return { kind: "whole", inside: resolved };
		if (f.kind === "expr" && isRef(f.expr)) {
			const again = resolve(f.expr.slice(1), at, probe);
			return again.kind === "inside" ? { kind: "whole", inside: again } : again;
		}
		return f as Exclude<Followed, { kind: "whole" }>;
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
		if (name === "record") {
			const fields = rest.length === 1 ? asRecord(rest[0]) : undefined;
			if (!fields) {
				return broken(
					"expr.invalid",
					"record takes one object of fields",
					path,
				);
			}
			const compiled = Object.entries(fields).map(
				([k, x]) => [k, node(x, [...path, 1])] as const,
			);
			return typed(
				(values) => {
					const out: Record<string, unknown> = {};
					for (const [k, x] of compiled) {
						const r = x(values);
						if (!r.ok) return r;
						out[k] = toJson(r.value);
					}
					return ok(out);
				},
				{ base: "json", nullable: false },
			);
		}
		if (name === "error") {
			const { message = "this expression has an error" } = (rest[0] ?? {}) as {
				message?: string;
			};
			return broken("expr.error", message, path);
		}
		if (name === "fn") {
			return broken(
				"lambda.where",
				"a lambda only goes as the last argument of map or filter",
				path,
			);
		}
		if (name === "entity") {
			return broken(
				"entity.where",
				"an entity is only built by a derived member: e.entity(…), or a map whose lambda gives one",
				path,
			);
		}
		if (name === "map" || name === "filter") {
			return lambdaCall(name, x as BuilderExpr, path);
		}
		if (name === "ref") {
			const param = paramNamed(rest[0]);
			if (param && param.kind !== "element") {
				return paramRef(param, rest.slice(1), path);
			}
			if (param && rest.length === 1) {
				return broken(
					"lambda.element",
					`"${param.name}" is an element of a collection: read one of its members, as ["ref", "${param.name}", "qty"]`,
					path,
				);
			}
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
			const resolved = resolveInto(rest, path);
			if (resolved.kind === "error") {
				return broken(resolved.code, resolved.message, path);
			}
			if (resolved.kind === "null") return typed(() => ok(null), NULL);
			if (resolved.kind === "expr") return node(resolved.expr, path);
			if (resolved.kind === "whole") {
				// Read the whole value, and look inside it when it runs.
				const { value, rest: inside } = resolved.inside;
				if (inside.includes("$each")) {
					return broken(
						"skeleton.unsupported",
						`"$each" inside a value the checker can't follow isn't supported yet`,
						path,
					);
				}
				const whole = node(refTo(value), path);
				return typed((args) => {
					const r = whole(args);
					return r.ok ? ok(lookInside(r.value, inside)) : r;
				}, ANY);
			}
			if (resolved.kind === "list") {
				// Outside an aggregate, a list is a value of its own, such as a part of your data document.
				const i = refIndex({
					kind: "fold",
					list: resolved.list,
					each: resolved.each,
					aggregate: COLLECT,
					...(resolved.up === undefined ? {} : { up: resolved.up }),
					...(resolved.param ? { param: true } : {}),
				});
				return typed((args) => ok(args[i]), LIST);
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
			// A map or filter over a collection: the fold runs their lambdas once per element.
			const over =
				args.length === 1 && isLambdaCall(args[0])
					? chain(args[0], [...path, 1])
					: undefined;
			if (over && "error" in over) return over.error;
			const list =
				!over && args.length === 1 && isRef(args[0])
					? resolveInto(args[0].slice(1), [...path, 1], true)
					: undefined;
			const compiled =
				over || list?.kind === "list"
					? []
					: args.map((arg, i) => node(arg, [...path, i + 1]));
			// A JSON array that map or filter made: the aggregate folds its items.
			const items = compiled.length === 1 ? compiled[0]?.items : undefined;
			const element = over
				? (over.value ?? ID)
				: list?.kind === "list"
					? join(list.owners.map((o) => compiler.type(o)))
					: (items ?? join(compiled.map((c) => c.type)));
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
			if (over) {
				const i = refIndex(foldOf(over, fold));
				return typed((values) => ok(zero(values[i])), type);
			}
			if (list?.kind === "list") {
				const i = refIndex({
					kind: "fold",
					list: list.list,
					each: list.each,
					aggregate: fold,
					...(list.up === undefined ? {} : { up: list.up }),
					...(list.param ? { param: true } : {}),
				});
				return typed((values) => ok(zero(values[i])), type);
			}
			// Values given one by one, as in ["sum", ["ref", "q1"], ["ref", "q2"]], or a JSON array's items.
			return typed((values) => {
				let each: readonly Eval[] | unknown[] = compiled;
				if (items) {
					const r = (compiled[0] as Eval)(values);
					if (!r.ok) return r;
					each = r.value as unknown[];
				}
				let acc = fold.init();
				for (const arg of each) {
					const r = items ? ok(arg) : (arg as Eval)(values);
					if (!r.ok) {
						if (fold.skipErrors) continue;
						return r;
					}
					acc = fold.add(acc, r.value);
				}
				try {
					return ok(zero(fold.result(acc)));
				} catch (e) {
					if (e instanceof FnError) return fail(e.code, e.message);
					throw e;
				}
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

	/** A lambda's parameter that isn't an element: the value it stands for, or what is inside it. */
	const paramRef = (
		param: Exclude<Lambda, { kind: "element" }>,
		inside: readonly unknown[],
		path: number[],
	): Eval => {
		if (param.kind === "outside") {
			return broken(
				"skeleton.unsupported",
				`a lambda over a collection can't read "${param.name}", the parameter of a lambda around it, yet`,
				path,
			);
		}
		const read = (v: unknown) =>
			inside.length === 0 ? ok(v) : ok(lookInside(v, inside));
		const type = inside.length === 0 ? param.type : ANY;
		if (param.kind === "stage") {
			const i = refIndex({ kind: "param" });
			return typed((args) => read(args[i]), type);
		}
		const { slot } = param;
		return typed(() => read(slot.value), type);
	};

	/** `["fn", [name], body]` as the last argument; a diagnostic when it isn't. */
	const lambdaOf = (
		x: readonly ExprArg[],
		path: number[],
	): { name: string; body: ExprArg } | { error: Eval } => {
		const f = x[2];
		const name = Array.isArray(f) && Array.isArray(f[1]) ? f[1][0] : undefined;
		if (
			x.length !== 3 ||
			!Array.isArray(f) ||
			f[0] !== "fn" ||
			f.length !== 3 ||
			(f[1] as unknown[]).length !== 1 ||
			typeof name !== "string" ||
			RESERVED.has(name)
		) {
			return {
				error: broken(
					"lambda.invalid",
					`${String(x[0])} takes a collection or a JSON array, then a lambda: ["fn", ["row"], body]`,
					path,
				),
			};
		}
		// A parameter hides what has its name, as an entity's own member hides a sibling.
		if (paramNamed(name) || inScope(name, scope, compiler.shapes)) {
			compiler.report({
				code: "scope.shadowed",
				severity: "warning",
				message: `the lambda's parameter "${name}" hides what has the same name here`,
				at: scope.at,
				field: scope.field,
				exprPath: where([...path, 2]),
			});
		}
		return { name, body: f[2] };
	};

	/**
	 * A `map` or `filter` over a collection, and those it is over: the
	 * collection, and each lambda compiled on its own, to run once per
	 * element. `undefined` when it isn't over a collection.
	 */
	const chain = (
		x: ExprArg | undefined,
		path: number[],
	): Chain | { error: Eval } | undefined => {
		if (isRef(x)) {
			const param = paramNamed(x[1]);
			if (param && param.kind !== "element") return undefined;
			const at = param
				? resolveCollectionIn(x.slice(2), param.shapes, compiler.shapes)
				: resolveCollection(x.slice(1), scope, compiler.shapes);
			return at && { ...at, stages: [], ...(param ? { param: true } : {}) };
		}
		if (!isLambdaCall(x)) return undefined;
		const inner = chain(x[1], [...path, 1]);
		if (!inner || "error" in inner) return inner;
		const lambda = lambdaOf(x, path);
		if ("error" in lambda) return lambda;
		const param: Lambda =
			inner.value === undefined
				? { name: lambda.name, kind: "element", shapes: inner.shapes }
				: { name: lambda.name, kind: "stage", type: inner.value };
		const { expect: _, ...outer } = scope;
		const body = compile(
			lambda.body,
			{
				...outer,
				params: [
					...params.map((p) => ({ name: p.name, kind: "outside" as const })),
					param,
				],
				base: where([...path, 2, 2]),
			},
			compiler,
		);
		if (x[0] === "filter") {
			const bad = misfit(BOOL, body.type);
			if (bad) {
				return {
					error: broken(
						"call.types",
						`a filter's lambda gives true or false; ${bad.message}`,
						[...path, 2, 2],
					),
				};
			}
		}
		const stage: Stage = {
			kind: x[0],
			refs: body.plan.refs,
			compute: body.plan.compute,
		};
		return {
			...inner,
			stages: [...inner.stages, stage],
			...(x[0] === "map" ? { value: body.type } : {}),
		};
	};

	/**
	 * `map` or `filter` as a value. Over a collection: a JSON array of what
	 * each element gives, or of the ids a filter keeps. Over a JSON array:
	 * another, recomputed whole.
	 */
	const lambdaCall = (
		name: "map" | "filter",
		x: BuilderExpr,
		path: number[],
	): Eval => {
		const over = chain(x, path);
		if (over && "error" in over) return over.error;
		if (over) {
			const i = refIndex(foldOf(over, COLLECT));
			return Object.assign(
				typed((args) => ok(args[i]), LIST),
				{ items: over.value ?? ID },
			);
		}
		const lambda = lambdaOf(x, path);
		if ("error" in lambda) return lambda.error;
		const list = node(x[1] ?? null, [...path, 1]);
		if (list.type.base !== "json" && list.type.base !== "null") {
			return broken(
				"call.types",
				`${name} takes a collection or a JSON array, not ${describe(list.type)}`,
				[...path, 1],
			);
		}
		const item = list.items ?? ANY;
		const slot: { value: unknown } = { value: undefined };
		params.push({ name: lambda.name, kind: "item", slot, type: item });
		let body: Eval;
		try {
			body = node(lambda.body, [...path, 2, 2]);
		} finally {
			params.pop();
		}
		if (name === "filter") {
			const bad = misfit(BOOL, body.type);
			if (bad) {
				return broken(
					"call.types",
					`a filter's lambda gives true or false; ${bad.message}`,
					[...path, 2, 2],
				);
			}
		}
		const run = typed((args) => {
			const l = list(args);
			if (!l.ok) return l;
			if (l.value === null) return ok(null);
			if (!Array.isArray(l.value)) {
				return fail("type.mismatch", `${name} takes a JSON array`);
			}
			const out: unknown[] = [];
			for (const v of l.value) {
				slot.value = v;
				const r = body(args);
				if (!r.ok) return r;
				if (name === "map") out.push(r.value);
				else if (r.value === true) out.push(v);
			}
			return ok(out);
		}, LIST);
		return Object.assign(run, { items: name === "map" ? body.type : item });
	};

	return { refs, node, chain, broken };
}

/**
 * The first signature every argument fits; `maybe` when the checker can't
 * tell before one that surely fits, so the call picks at run time; `none`
 * when none fits. A signature that takes a `null` wins, so one whose
 * parameter only `nulls` fits is picked here only when no later signature
 * could take that `null`, and only if it has `forwardNull`: otherwise
 * nothing takes the `null`, and the call is `none`.
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
		if (later) return "maybe";
		return own.includes("nulls") && !s.forwardNull ? "none" : s;
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

/** Collects a list's values, for a list outside an aggregate. */
const COLLECT: Fold<unknown[]> = {
	init: () => [],
	add: (acc, v) => {
		acc.push(v);
		return acc;
	},
	result: (acc) => [...acc],
};

/** What a path names inside a JSON value: `null` when nothing is there. */
function lookInside(value: unknown, path: readonly unknown[]): Json {
	let here = toJson(value);
	for (const step of path) {
		const at = asRecord(step)?.at;
		if (Array.isArray(here) && typeof at === "number") {
			here = here[at < 0 ? here.length + at : at] ?? null;
		} else if (
			typeof step === "string" &&
			typeof here === "object" &&
			here !== null &&
			!Array.isArray(here)
		) {
			here = (here as Record<string, Json>)[step] ?? null;
		} else return null;
	}
	return here;
}

/** `["map", …]` or `["filter", …]`. */
function isLambdaCall(
	x: ExprArg | undefined,
): x is readonly ["map" | "filter", ...ExprArg[]] {
	return Array.isArray(x) && (x[0] === "map" || x[0] === "filter");
}

/** Names a lambda's parameter can't have: they start paths of their own. */
const RESERVED = new Set([
	"$root",
	"$parent",
	"$prev",
	"$next",
	"$index",
	"$key",
	"$each",
]);

/** What a filter's lambda gives. */
const BOOL: TypeSpec = { base: "bool", nullable: true, checks: [] };

/** What an element gives without a map: its id. */
const ID: StaticType = { base: "text", nullable: false };

/** `["ref", …]`, as an aggregate's argument. */
function isRef(x: ExprArg | undefined): x is readonly ["ref", ...ExprArg[]] {
	return Array.isArray(x) && x[0] === "ref";
}

/** A signature's parameter names, in order. */
function namesOf(f: KitFn, signature: FnSpec): string[] {
	return paramList(f.name, signature).map(([name]) => name);
}

/** A plain object, such as named arguments; not an array or `null`. */
function asRecord(x: unknown): Readonly<Record<string, ExprArg>> | undefined {
	return typeof x === "object" && x !== null && !Array.isArray(x)
		? (x as Readonly<Record<string, ExprArg>>)
		: undefined;
}
