import type { Decimal } from "../values";
import type { Entity } from "./entity";
import type {
	Arith,
	CallN,
	Elem,
	IfRet,
	KnownN,
	LitN,
	NodeIn,
	ParamN,
	SelfN,
} from "./expr";
import type { ExprType, Initial, Optional, ValueType } from "./types";

export type Def<E> = E extends Entity<any, infer D> ? D : never;
export type Cfg<D> = D extends { config: infer C } ? C : {};
export type Inp<D> = D extends { inputs: infer I } ? I : {};
export type Der<D> = D extends { derived: infer V } ? V : {};

/** The value a member type holds, for value members. */
export type ValueOfType<X> =
	X extends Initial<infer V>
		? V
		: X extends ValueType<infer V>
			? V
			: X extends ExprType<infer V>
				? V
				: X extends Optional<infer Y>
					? ValueOfType<Y> | undefined
					: unknown;

export type IsNumLit<V> = [V] extends [number] ? true : false;
export type ArithResult<A, B> = [A] extends [Decimal]
	? Decimal
	: [B] extends [Decimal]
		? Decimal
		: A extends number
			? number
			: unknown;
export type ElemOf<L> = L extends readonly (infer X)[] ? X : unknown;

export type Eval<N, D> =
	N extends SelfN<infer K, infer F>
		? SelfValue<D, K, F>
		: N extends LitN<infer V>
			? V
			: N extends ParamN<any, infer V>
				? V
				: N extends KnownN<infer V>
					? V
					: N extends CallN<infer S, infer A>
						? CallValue<S["ret"], A, D>
						: unknown;

export type SelfValue<D, K extends string, F> = [F] extends [never]
	? MemberValue<D, K>
	: Exclude<MemberValue<D, K>, undefined>;

export type CallValue<R, A extends readonly unknown[], D> = R extends Arith
	? ArithResult<Eval<A[0], D>, Eval<A[1], D>>
	: R extends Elem
		? ElemOf<Eval<A[0], D>>
		: R extends IfRet
			? IsNumLit<Eval<A[1], D>> extends true
				? Eval<A[2], D>
				: Eval<A[1], D>
			: R;

export type MemberValue<D, K extends string> = K extends keyof Inp<D>
	? ValueOfType<Inp<D>[K]>
	: K extends keyof Der<D>
		? Eval<NodeIn<Der<D>[K]>, D>
		: K extends keyof Cfg<D>
			? ValueOfType<Cfg<D>[K]>
			: unknown;

/** A derived value is writable when every call down to an input has exactly one writable argument with an inverse. */
export type Writable<N, D> =
	N extends SelfN<infer K, any>
		? K extends keyof Inp<D>
			? IsValueInput<Inp<D>[K]>
			: K extends keyof Der<D>
				? Writable<NodeIn<Der<D>[K]>, D>
				: false
		: N extends CallN<infer S, infer A>
			? OneWritable<WritableArgs<A, D>, S["inv"]>
			: false;
export type IsValueInput<X> = X extends Initial<any> | ValueType<any>
	? true
	: false;
export type WritableArgs<A extends readonly unknown[], D> = {
	[I in keyof A]: Writable<A[I], D>;
};
export type OneWritable<
	Ws extends readonly unknown[],
	Inv extends readonly boolean[],
> =
	CountTrue<Ws> extends 1
		? TrueAtInverse<Ws, Inv> extends true
			? true
			: false
		: false;
export type CountTrue<
	Ws extends readonly unknown[],
	Acc extends unknown[] = [],
> = Ws extends readonly [infer H, ...infer Rest]
	? CountTrue<Rest, H extends true ? [...Acc, 1] : Acc>
	: Acc["length"];
export type TrueAtInverse<
	Ws extends readonly unknown[],
	Inv extends readonly boolean[],
> = Ws extends readonly [infer H, ...infer Rest]
	? H extends true
		? Inv extends readonly [infer I, ...any[]]
			? I
			: false
		: TrueAtInverse<
				Rest,
				Inv extends readonly [any, ...infer IR extends boolean[]] ? IR : []
			>
	: false;

export type MemberIsWritable<D, K extends string> = K extends keyof Inp<D>
	? IsValueInput<Inp<D>[K]>
	: K extends keyof Der<D>
		? Writable<NodeIn<Der<D>[K]>, D>
		: false;
