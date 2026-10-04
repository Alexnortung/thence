import type { IsUnion, Simplify, UnionToIntersection } from "type-fest";
import type { CallN, Ex, NamedCallN, NodeIn, ParamN } from "./expr";
import type { Eval, OneNamedWritable, OneWritable } from "./infer";
import type { In, ListT, ValueType } from "./types";

/**
 * The values an `impl` or `inverse` gets, by parameter name.
 *
 * @typeParam P - the parameters' value types
 */
export type ParamsOf<P extends Record<string, ValueType<any>>> = {
	[K in keyof P]: P[K]["~v"];
};
/**
 * One parameter, as an entry of `params`: an object with exactly one key,
 * its name, such as `{ qty: t.number }`.
 *
 * @typeParam T - the parameter's type
 */
export type Param<T extends ParamType = ParamType> = Readonly<
	Record<string, T>
>;
/**
 * The parameters by name, from `params` as written.
 *
 * @typeParam L - the list, such as `[{ a: t.number }, { b: t.number }]`
 */
export type ParamsByName<L extends readonly Param<any>[]> = [
	L[number],
] extends [never]
	? {}
	: Writable<UnionToIntersection<L[number]>>;
/** An object type without `readonly`, as `const` inference makes `params`. */
type Writable<T> = Simplify<{ -readonly [K in keyof T]: T[K] }>;
/**
 * `params` as written, with an error in place of an entry that doesn't name
 * exactly one parameter.
 *
 * @typeParam L - the list as written
 */
export type CheckParams<L extends readonly Param<any>[]> = {
	[I in keyof L]: [keyof L[I]] extends [never]
		? { "~error": "a parameter entry names exactly one parameter" }
		: IsUnion<keyof L[I]> extends true
			? { "~error": "a parameter entry names exactly one parameter" }
			: L[I];
};
/**
 * A function the kit offers, made by `fn()`. Expressions call it with `e.call`,
 * and Builders by name. `std`'s functions are made the same way.
 *
 * @typeParam N - its name, as Builders call it
 * @typeParam P - its parameters' value types, by name (`params` is a list,
 *   which this indexes by name for `e.call`)
 * @typeParam R - its return type
 * @typeParam Inv - for each parameter, whether it has an inverse
 */
export interface Fn<
	N extends string,
	P extends Record<string, ValueType<any>>,
	R,
	Inv extends Record<string, boolean>,
> {
	readonly "~kind": "fn";
	readonly name: N;
	readonly "~params": P;
	readonly "~ret": R;
	readonly "~inv": Inv;
	/** Its signatures, as `fn()` was given them: one, or several for overloads. */
	readonly signatures: readonly FnSpec[];
}
/**
 * One signature of a function, as plain data: its parameters, what it
 * returns, and how it computes it, with a TypeScript `impl`, an expression
 * `body`, or an incremental `aggregate`. A function has one or more; the
 * checker uses the first that fits the arguments.
 */
export type FnSpec = FnSpecImpl | FnSpecBody | FnSpecAggregate;
/**
 * A parameter's type: a value type, or for an aggregate the list it folds,
 * such as `t.list(t.number)`.
 */
export type ParamType = ValueType<any> | ListT<ValueType<any>>;
/** What every signature declares. */
interface FnSpecBase {
	/**
	 * The parameters, in the order positional arguments fill them, one
	 * `{ name: type }` entry each: `[{ a: t.number }, { b: t.number }]`.
	 */
	readonly params: readonly Param[];
	/**
	 * The return type, or a parameter's name for "the same type as that
	 * argument" (for a list, as its elements), so that adding two `Money`
	 * decimals gives `Money`.
	 */
	readonly returns: ValueType<any> | string;
}
/**
 * A signature written in TypeScript. The checker can't see inside it, so an
 * inverse is written by hand. To fail with your own error code, throw an
 * `FnError`; anything else thrown becomes `fn.threw`.
 */
export interface FnSpecImpl extends FnSpecBase {
	/** Computes the result from the arguments, by parameter name. */
	readonly impl: (args: any) => unknown;
	/** For each parameter that can be written through: the argument that gives `result`, with the other arguments fixed. */
	readonly inverse?: Record<string, (args: any) => unknown>;
	/**
	 * Whether a `null` for a parameter that isn't nullable makes the call
	 * `null`, instead of a `call.types` error. std's arithmetic does this, so
	 * an empty cell in `price * qty` gives an empty result.
	 */
	readonly forwardNull?: boolean;
	readonly body?: never;
	readonly aggregate?: never;
}
/** A signature written as an expression. The checker derives each parameter's inverse from the body. */
export interface FnSpecBody extends FnSpecBase {
	/** Builds the expression from one expression per parameter. */
	readonly body: (params: any) => Ex<any>;
	readonly impl?: never;
	readonly inverse?: never;
	readonly forwardNull?: never;
	readonly aggregate?: never;
}
/** A signature that folds a list one element at a time, such as `sum`. Its one parameter is the list. */
export interface FnSpecAggregate extends FnSpecBase {
	readonly aggregate: Aggregate;
	readonly impl?: never;
	readonly body?: never;
	readonly inverse?: never;
	readonly forwardNull?: never;
}

/**
 * An incremental aggregate: the engine keeps an accumulator per collection and
 * adds or removes one element's value at a time. `add` and `remove` return the
 * accumulator to keep. Each collection gets its own from `init()`, so they may
 * change the one they get and return it.
 *
 * @typeParam A - the accumulator
 * @typeParam V - an element's value
 * @typeParam R - the result
 */
export interface Aggregate<A = any, V = any, R = any> {
	readonly "~kind": "aggregate";
	init(): A;
	add(acc: A, v: V): A;
	remove(acc: A, v: V): A;
	result(acc: A): R;
}

/**
 * Which parameters have a hand-written inverse.
 *
 * @typeParam P - the parameters
 * @typeParam I - the `inverse` object as written
 */
export type InvFlags<P, I> = {
	[K in keyof P]: K extends keyof I ? true : false;
};

/**
 * The body's parameters, one expression each, as `e.fn((row) => …)` gets its row.
 *
 * @typeParam P - the parameters' value types
 */
export type BodyParams<P extends Record<string, ValueType<any>>> = {
	[K in keyof P]: Ex<ParamN<K & string, P[K]["~v"]>>;
};
/**
 * Whether the body is writable through parameter K, with the other parameters fixed.
 *
 * @typeParam N - the body's syntax tree node
 * @typeParam K - the parameter's name
 */
export type ParamWritable<N, K> =
	N extends ParamN<infer K2, any>
		? [K2] extends [K]
			? true
			: false
		: N extends CallN<infer S, infer A>
			? OneWritable<{ [I in keyof A]: ParamWritable<A[I], K> }, S["inv"]>
			: N extends NamedCallN<infer S, infer A>
				? OneNamedWritable<{ [I in keyof A]: ParamWritable<A[I], K> }, S["inv"]>
				: false;
/**
 * Which parameters a body derives an inverse for.
 *
 * @typeParam P - the parameters
 * @typeParam N - the body's syntax tree node
 */
export type DerivedInvFlags<P, N> = { [K in keyof P]: ParamWritable<N, K> };

/**
 * `fn()`: a function the kit offers. Each signature takes an expression
 * `body`, a TypeScript `impl` with an optional `inverse` per parameter, or an
 * `aggregate`. Give several signatures for overloads, such as `add` on
 * numbers and on decimals.
 */
export interface FnFactory {
	/** A TypeScript function, with an optional inverse per parameter. */
	<
		const N extends string,
		const L extends readonly Param<ValueType<any>>[],
		R,
		I extends { [K in keyof ParamsByName<L>]?: unknown } = {},
	>(
		name: N,
		spec: {
			params: L & CheckParams<L>;
			returns: ValueType<R>;
			impl: (args: ParamsOf<ParamsByName<L>>) => In<R>;
			forwardNull?: boolean;
			body?: never;
			inverse?: I & {
				[K in keyof ParamsByName<L>]?: (
					args: { result: R } & ParamsOf<ParamsByName<L>>,
				) => In<ParamsOf<ParamsByName<L>>[K]>;
			};
		},
	): Fn<N, ParamsByName<L>, R, InvFlags<ParamsByName<L>, I>>;
	/** An aggregate over a list, such as `sum`: the engine adds and removes one element's value at a time. */
	<
		const N extends string,
		const L extends readonly Param<ListT<ValueType<any>>>[],
		R,
	>(
		name: N,
		spec: {
			params: L & CheckParams<L>;
			returns: ValueType<R>;
			aggregate: Aggregate<any, any, In<R>>;
			impl?: never;
			body?: never;
			inverse?: never;
		},
	): Fn<N, {}, R, {}>;
	/** An expression-bodied function: no `impl`, no `inverse`; each parameter's inverse is derived from the body. */
	<
		const N extends string,
		const L extends readonly Param<ValueType<any>>[],
		R,
		B extends Ex<any>,
	>(
		name: N,
		spec: {
			params: L & CheckParams<L>;
			returns: ValueType<R>;
			body: (
				params: BodyParams<ParamsByName<L>>,
			) => B &
				(Eval<NodeIn<B>, never> extends In<R>
					? unknown
					: { "~error": "the body's type doesn't match returns" });
			impl?: never;
			inverse?: never;
		},
	): Fn<N, ParamsByName<L>, R, DerivedInvFlags<ParamsByName<L>, NodeIn<B>>>;
	/**
	 * Several signatures, as overloads. The checker uses the first that fits
	 * the arguments. Calls to it aren't typed with `e.call` yet.
	 */
	<const N extends string>(
		name: N,
		first: FnSpec,
		second: FnSpec,
		...rest: FnSpec[]
	): Fn<N, Record<string, ValueType<any>>, unknown, {}>;
	/** An incremental aggregate, for a signature's `aggregate`: the engine adds and removes one value at a time. */
	aggregate<A, V, R>(spec: {
		init: A;
		add(acc: A, v: V): A;
		remove(acc: A, v: V): A;
		result(acc: A): R;
	}): Aggregate<A, V, R>;
}
