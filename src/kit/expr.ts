import { shell } from "../shell";
import type { Json } from "../values";
import type { AnyEntity, AnyTrait } from "./entity";
import type { Fn } from "./fn";
import type { ValueOfType } from "./infer";

/** A Builder's expression: JSON with a name first. */
export type BuilderExpr = readonly [string, ...ExprArg[]];
export type ExprArg =
	| BuilderExpr
	| number
	| boolean
	| null
	| string
	| { readonly [k: string]: ExprArg };

/** An expression built with e.*: JSON at run time, a typed syntax tree for TypeScript. */
export interface Ex<N = unknown> {
	readonly "~ex": N;
}
/** Either kind of expression, as the README's `Expr` import. */
export type Expr = BuilderExpr | Ex<any>;

// syntax tree nodes (type level only)
export interface SelfN<K extends string, F> {
	self: K;
	fb: F;
}
export interface LitN<V> {
	lit: V;
}
export interface KnownN<V> {
	known: V;
}
/** a parameter inside an expression-bodied fn() */
export interface ParamN<K extends string, V> {
	param: K;
	v: V;
}
export interface CallN<S extends Sig, A extends readonly unknown[]> {
	sig: S;
	args: A;
}
export interface Sig {
	ret: unknown;
	inv: readonly boolean[];
}
/** result kinds the std arithmetic and aggregates compute from their arguments */
export interface Arith {
	"~arith": true;
}
export interface Elem {
	"~elem": true;
}
export interface IfRet {
	"~if": true;
}

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
export type Nodes<Xs extends readonly unknown[]> = {
	[I in keyof Xs]: NodeIn<Xs[I]>;
};
export type Arg = Ex<any> | BuilderExpr | number | boolean | string | null;

export type Call<
	Ret,
	Inv extends readonly boolean[],
	Xs extends readonly unknown[],
> = Ex<CallN<{ ret: Ret; inv: Inv }, Nodes<Xs>>>;

export type TraitMemberValue<T, M> = T extends AnyTrait
	? M extends keyof T["~members"]
		? ValueOfType<T["~members"][M]>
		: unknown
	: unknown;
export type TraitArg = AnyTrait | string;

export const e: {
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
	keyed<T extends AnyTrait, const M extends string>(
		member: string,
		trait: T,
		m: M,
	): Ex<KnownN<Json>>;
	key(): Ex<KnownN<string>>;
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

	call<F extends Fn<string, any, any, any>, const Xs extends readonly Arg[]>(
		f: F,
		...args: Xs
	): Call<F["~ret"], F["~inv"], Xs>;
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
} = shell("e");

export interface DerivedEntity<E extends AnyEntity> {
	readonly "~derivedEntity": E;
}
