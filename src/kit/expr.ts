import type { Json } from "../values";
import type { AnyEntity, AnyTrait } from "./entity";
import type { Fn } from "./fn";
import type { ValueOfType } from "./infer";

/** A Builder's expression: JSON with a name first, such as `["mul", ["ref", "qty"], 2]`. */
export type BuilderExpr = readonly [string, ...ExprArg[]];
/** An argument inside a Builder's expression: another expression, a literal or an object of arguments. */
export type ExprArg =
	| BuilderExpr
	| number
	| boolean
	| null
	| string
	| { readonly [k: string]: ExprArg };

/**
 * An expression built with `e.*`: JSON at run time, a typed syntax tree for
 * TypeScript, so the kit can infer what a derived member holds and whether it
 * is writable.
 *
 * @typeParam N - the syntax tree node, one of the `…N` types below
 */
export interface Ex<N = unknown> {
	readonly "~ex": N;
}
/** Either kind of expression, as the README's `Expr` import. */
export type Expr = BuilderExpr | Ex<any>;

// Syntax tree nodes. They exist only at the type level: Eval in infer.ts
// computes a node's value, and Writable whether it can be written through.

/**
 * `e.self(member, fallback?)`: a member of the same entity.
 *
 * @typeParam K - the member's name
 * @typeParam F - the fallback's type, `never` when there is none
 */
export interface SelfN<K extends string, F> {
	self: K;
	fb: F;
}
/**
 * A literal argument, such as the `2` in `e.mul(2, x)`. Never writable.
 *
 * @typeParam V - its type, widened: `number`, not `2`
 */
export interface LitN<V> {
	lit: V;
}
/**
 * A node whose value type is already known and that is never writable, such
 * as `e.concat(…)` (a string) or a trait member read with `e.as`.
 *
 * @typeParam V - its value type
 */
export interface KnownN<V> {
	known: V;
}
/**
 * A parameter inside an expression-bodied `fn()`.
 *
 * @typeParam K - the parameter's name
 * @typeParam V - its value type
 */
export interface ParamN<K extends string, V> {
	param: K;
	v: V;
}
/**
 * A call with positional arguments, such as `e.mul(a, b)`.
 *
 * @typeParam S - what the function returns and which parameters have an inverse
 * @typeParam A - the argument nodes, in order
 */
export interface CallN<S extends Sig, A extends readonly unknown[]> {
	sig: S;
	args: A;
}
/** A positional function's signature as the type level sees it. */
export interface Sig {
	/** the return type, or Arith, Elem or IfRet when it depends on the arguments */
	ret: unknown;
	/** for each parameter, whether it has an inverse */
	inv: readonly boolean[];
}
/**
 * A call to one of your own functions, with arguments by parameter name.
 *
 * @typeParam S - what the function returns and which parameters have an inverse
 * @typeParam A - the argument nodes, by parameter name
 */
export interface NamedCallN<
	S extends NamedSig,
	A extends Record<string, unknown>,
> {
	sig: S;
	args: A;
}
/** Which parameters have an inverse, by name. */
export interface NamedSig {
	ret: unknown;
	inv: Record<string, boolean>;
}
/** A return type computed from the arguments: a decimal if either argument is one, else a number. */
export interface Arith {
	"~arith": true;
}
/** A return type computed from the arguments: the element type of the list argument. */
export interface Elem {
	"~elem": true;
}
/** A return type computed from the arguments: the `then` branch's type, or `otherwise`'s when `then` is a plain number. */
export interface IfRet {
	"~if": true;
}

/**
 * The syntax tree node for an argument: an `e.*` expression's own node, a
 * literal for plain values, and an unknown node for a Builder's JSON.
 *
 * @typeParam X - the argument as written
 */
export type NodeIn<X> =
	X extends Ex<infer N>
		? N
		: X extends number
			? LitN<number>
			: X extends boolean
				? LitN<boolean>
				: X extends string
					? LitN<string>
					: X extends null
						? LitN<null>
						: KnownN<unknown>;
/**
 * {@link NodeIn} for each argument of a positional call.
 *
 * @typeParam Xs - the arguments as written
 */
export type Nodes<Xs extends readonly unknown[]> = {
	[I in keyof Xs]: NodeIn<Xs[I]>;
};
/** Anything `e.*` takes as an argument. */
export type Arg = Ex<any> | BuilderExpr | number | boolean | string | null;

/**
 * The expression a positional `e.*` call returns.
 *
 * @typeParam Ret - the return type, or Arith, Elem or IfRet
 * @typeParam Inv - for each parameter, whether it has an inverse
 * @typeParam Xs - the arguments as written
 */
export type Call<
	Ret,
	Inv extends readonly boolean[],
	Xs extends readonly unknown[],
> = Ex<CallN<{ ret: Ret; inv: Inv }, Nodes<Xs>>>;

/**
 * The value of a trait's member, or `unknown` when the trait is given by name.
 *
 * @typeParam T - the trait, or its name as a string
 * @typeParam M - the member's name
 */
export type TraitMemberValue<T, M> = T extends AnyTrait
	? M extends keyof T["~members"]
		? ValueOfType<T["~members"][M]>
		: unknown
	: unknown;
/** A trait, or its name when the trait isn't in scope. */
export type TraitArg = AnyTrait | string;

/** The expression builders: `e.self("qty")`, `e.mul(2, x)`, `e.call(f, { … })`. See the README's expression reference. */
export interface ExprBuilders {
	self<const K extends string, F = never>(
		member: K,
		fallback?: F,
	): Ex<SelfN<K, F>>;
	as<T extends TraitArg, const M extends string>(
		trait: T,
		member: M,
		fallback?: unknown,
	): Ex<KnownN<TraitMemberValue<T, M>>>;
	up<T extends TraitArg, const M extends string, F>(
		trait: T,
		member: M,
		fallback: F,
	): Ex<KnownN<TraitMemberValue<T, M> | F>>;
	each<T extends AnyTrait, const M extends string>(
		member: string,
		trait: T,
		m: M,
	): Ex<KnownN<readonly TraitMemberValue<T, M>[]>>;
	/** The elements' own member, without a trait. Not typed yet: the element's entity isn't known here. */
	each(member: string, m: string): Ex<KnownN<readonly unknown[]>>;
	keyed<T extends AnyTrait, const M extends string>(
		member: string,
		trait: T,
		m: M,
	): Ex<KnownN<Json>>;
	/**
	 * This entity's key in the map that holds it. Always the map that directly
	 * holds the entity, however deeply it is nested: an entity sees only
	 * itself. A row that needs its parent's key reads it from the parent
	 * through a trait, with `e.up`, and the parent exposes it as a derived
	 * member.
	 */
	key(): Ex<KnownN<string>>;
	/** This entity's position in the list that directly holds it; see {@link ExprBuilders.key}. */
	index(): Ex<KnownN<number>>;
	text(s: string): Ex<LitN<string>>;

	add<A extends Arg, B extends Arg>(
		a: A,
		b: B,
	): Call<Arith, [true, true], [A, B]>;
	sub<A extends Arg, B extends Arg>(
		a: A,
		b: B,
	): Call<Arith, [true, true], [A, B]>;
	mul<A extends Arg, B extends Arg>(
		a: A,
		b: B,
	): Call<Arith, [true, true], [A, B]>;
	div<A extends Arg, B extends Arg>(
		a: A,
		b: B,
	): Call<Arith, [true, true], [A, B]>;
	sum<A extends Arg>(list: A): Call<Elem, [false], [A]>;
	if<C extends Arg, A extends Arg, B extends Arg>(
		cond: C,
		then: A,
		otherwise: B,
	): Call<IfRet, [false, false, false], [C, A, B]>;
	and(...xs: Arg[]): Ex<KnownN<boolean>>;
	or(...xs: Arg[]): Ex<KnownN<boolean>>;
	eq(a: Arg, b: Arg): Ex<KnownN<boolean>>;
	gt(a: Arg, b: Arg): Ex<KnownN<boolean>>;
	isNull(a: Arg): Ex<KnownN<boolean>>;
	contains(list: Arg, x: Arg): Ex<KnownN<boolean>>;
	concat(...xs: Arg[]): Ex<KnownN<string>>;
	record(fields: Record<string, Arg>): Ex<KnownN<Json>>;
	entry(key: Arg, x: Arg): Ex<KnownN<Json>>;
	merge(...xs: Arg[]): Ex<KnownN<Json>>;

	/** Calls one of your own functions with named arguments, so each argument meets its parameter's inverse by name. */
	call<
		F extends Fn<string, any, any, any>,
		const Xs extends { readonly [K in keyof F["~params"]]: Arg },
	>(
		f: F,
		args: Xs,
	): Ex<
		NamedCallN<
			{ ret: F["~ret"]; inv: F["~inv"] },
			{ [K in keyof Xs]: NodeIn<Xs[K]> }
		>
	>;
	entity<E extends AnyEntity>(
		entity: E,
		inputs: { [K in keyof E["~def"]["inputs"]]: Arg },
	): Ex<KnownN<DerivedEntity<E>>>;
	fn<R extends Arg>(
		body: (param: (member: string) => Ex<KnownN<unknown>>) => R,
	): Ex<KnownN<(x: unknown) => unknown>>;
	map<R>(
		list: Arg,
		f: Ex<KnownN<(x: unknown) => R>>,
	): Ex<KnownN<readonly unknown[]>>;
	filter(list: Arg, f: Arg): Ex<KnownN<readonly unknown[]>>;
}

/**
 * The value of `e.entity(EVat, {…})`: an entity the expression creates, which
 * makes the derived member an entity member rather than a value.
 *
 * @typeParam E - the entity created
 */
export interface DerivedEntity<E extends AnyEntity> {
	readonly "~derivedEntity": E;
}
