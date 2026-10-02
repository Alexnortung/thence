import type { IsNever, IsUnion } from "type-fest";
import type { Decimal } from "../values";
import type { Entity } from "./entity";
import type {
	Arith,
	CallN,
	Elem,
	IfRet,
	KnownN,
	LitN,
	NamedCallN,
	NodeIn,
	ParamN,
	SelfN,
} from "./expr";
import type { ExprType, Initial, Optional, ValueType } from "./types";

/**
 * An entity's parts, as `entity()` inferred them.
 *
 * @typeParam E - the entity
 */
export type Def<E> = E extends Entity<any, infer D> ? D : never;
/**
 * An entity's config members, or `{}`.
 *
 * @typeParam D - the entity's parts, from {@link Def}
 */
export type Cfg<D> = D extends { config: infer C } ? C : {};
/**
 * An entity's inputs, or `{}`.
 *
 * @typeParam D - the entity's parts, from {@link Def}
 */
export type Inp<D> = D extends { inputs: infer I } ? I : {};
/**
 * An entity's derived members, or `{}`.
 *
 * @typeParam D - the entity's parts, from {@link Def}
 */
export type Der<D> = D extends { derived: infer V } ? V : {};

/**
 * The value a member type holds, for value members; `unknown` for the rest.
 *
 * @typeParam X - the member type, such as `t.number.initial(0)`
 */
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

/**
 * Whether a value type is `number`. `e.if` uses it so `e.if(c, 0, price)` takes the decimal type of `price`.
 *
 * @typeParam V - the value type
 */
export type IsNumLit<V> = [V] extends [number] ? true : false;
/**
 * What `e.add`, `sub`, `mul` and `div` return: a decimal if either argument is one, else a number.
 *
 * @typeParam A - the first argument's value type
 * @typeParam B - the second argument's value type
 */
export type ArithResult<A, B> = [A] extends [Decimal]
	? Decimal
	: [B] extends [Decimal]
		? Decimal
		: A extends number
			? number
			: unknown;
/**
 * The element type of a list.
 *
 * @typeParam L - the list type
 */
export type ElemOf<L> = L extends readonly (infer X)[] ? X : unknown;

/**
 * The value type an expression computes.
 *
 * @typeParam N - the expression's syntax tree node
 * @typeParam D - the parts of the entity it is evaluated in, from {@link Def}
 */
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
						: N extends NamedCallN<infer S, any>
							? S["ret"]
							: unknown;

/**
 * What `e.self(member, fallback?)` reads. A fallback removes `undefined`.
 *
 * @typeParam D - the entity's parts
 * @typeParam K - the member's name
 * @typeParam F - the fallback's type, `never` when there is none
 */
export type SelfValue<D, K extends string, F> =
	IsNever<F> extends true
		? MemberValue<D, K>
		: Exclude<MemberValue<D, K>, undefined>;

/**
 * What a positional call returns, working out Arith, Elem and IfRet from its arguments.
 *
 * @typeParam R - the signature's return type
 * @typeParam A - the argument nodes
 * @typeParam D - the entity's parts
 */
export type CallValue<R, A extends readonly unknown[], D> = R extends Arith
	? ArithResult<Eval<A[0], D>, Eval<A[1], D>>
	: R extends Elem
		? ElemOf<Eval<A[0], D>>
		: R extends IfRet
			? IsNumLit<Eval<A[1], D>> extends true
				? Eval<A[2], D>
				: Eval<A[1], D>
			: R;

/**
 * The value a member of an entity holds, whether it is an input, a derived value or config.
 *
 * @typeParam D - the entity's parts, from {@link Def}
 * @typeParam K - the member's name
 */
export type MemberValue<D, K extends string> = K extends keyof Inp<D>
	? ValueOfType<Inp<D>[K]>
	: K extends keyof Der<D>
		? Eval<NodeIn<Der<D>[K]>, D>
		: K extends keyof Cfg<D>
			? ValueOfType<Cfg<D>[K]>
			: unknown;

/**
 * Whether an expression can be written through: true when every call down to
 * an input has exactly one writable argument, and that parameter has an inverse.
 *
 * @typeParam N - the expression's syntax tree node
 * @typeParam D - the entity's parts, from {@link Def}
 */
export type Writable<N, D> =
	N extends SelfN<infer K, any>
		? K extends keyof Inp<D>
			? IsValueInput<Inp<D>[K]>
			: K extends keyof Der<D>
				? Writable<NodeIn<Der<D>[K]>, D>
				: false
		: N extends CallN<infer S, infer A>
			? OneWritable<WritableArgs<A, D>, S["inv"]>
			: N extends NamedCallN<infer S, infer A>
				? OneNamedWritable<{ [K in keyof A]: Writable<A[K], D> }, S["inv"]>
				: false;
/**
 * Whether an input holds a plain value the Operator can set.
 *
 * @typeParam X - the input's member type
 */
export type IsValueInput<X> = X extends Initial<any> | ValueType<any>
	? true
	: false;
/**
 * {@link Writable} for each argument of a positional call.
 *
 * @typeParam A - the argument nodes
 * @typeParam D - the entity's parts
 */
export type WritableArgs<A extends readonly unknown[], D> = {
	[I in keyof A]: Writable<A[I], D>;
};
/**
 * The writability rule for a positional call: exactly one writable argument, and its parameter has an inverse.
 *
 * @typeParam Ws - for each argument, whether it is writable
 * @typeParam Inv - for each parameter, whether it has an inverse
 */
export type OneWritable<
	Ws extends readonly unknown[],
	Inv extends readonly boolean[],
> =
	CountTrue<Ws> extends 1
		? TrueAtInverse<Ws, Inv> extends true
			? true
			: false
		: false;
/**
 * The same rule for named arguments: exactly one writable argument, and its parameter has an inverse.
 *
 * @typeParam Ws - for each argument by name, whether it is writable
 * @typeParam Inv - for each parameter by name, whether it has an inverse
 */
export type OneNamedWritable<Ws, Inv> =
	TrueKeys<Ws> extends infer K
		? IsNever<K> extends true
			? false
			: IsUnion<K> extends true
				? false
				: K extends keyof Inv
					? Inv[K]
					: false
		: false;
/**
 * The keys whose value is `true`.
 *
 * @typeParam W - an object of booleans
 */
export type TrueKeys<W> = {
	[K in keyof W]: W[K] extends true ? K : never;
}[keyof W];
/**
 * How many entries of a tuple are `true`.
 *
 * @typeParam Ws - a tuple of booleans
 * @typeParam Acc - the count so far, as a tuple's length
 */
export type CountTrue<
	Ws extends readonly unknown[],
	Acc extends unknown[] = [],
> = Ws extends readonly [infer H, ...infer Rest]
	? CountTrue<Rest, H extends true ? [...Acc, 1] : Acc>
	: Acc["length"];
/**
 * Whether the parameter at the first `true` in Ws has an inverse.
 *
 * @typeParam Ws - for each argument, whether it is writable
 * @typeParam Inv - for each parameter, whether it has an inverse
 */
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

/**
 * Whether a member of an entity can be set: a value input, or a derived value
 * that is {@link Writable}. Config never can.
 *
 * @typeParam D - the entity's parts, from {@link Def}
 * @typeParam K - the member's name
 */
export type MemberIsWritable<D, K extends string> = K extends keyof Inp<D>
	? IsValueInput<Inp<D>[K]>
	: K extends keyof Der<D>
		? Writable<NodeIn<Der<D>[K]>, D>
		: false;
