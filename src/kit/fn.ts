import { shell } from "../shell";

import type { CallN, Ex, NamedCallN, NodeIn, ParamN } from "./expr";
import type { Eval, OneNamedWritable, OneWritable } from "./infer";
import type { In, ValueType } from "./types";

/**
 * The values an `impl` or `inverse` gets, by parameter name.
 *
 * @typeParam P - the parameters' value types
 */
export type ParamsOf<P extends Record<string, ValueType<any>>> = {
	[K in keyof P]: P[K]["~v"];
};
/**
 * A function the kit offers, made by `fn()`. Expressions call it with `e.call`,
 * and Builders by name.
 *
 * @typeParam N - its name, as Builders call it
 * @typeParam P - its parameters' value types, by name
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

/** `fn()`: a function the kit offers. It takes an expression `body`, or a TypeScript `impl` with an optional `inverse` per parameter, never both. */
export interface FnFactory {
	/** A TypeScript function, with an optional inverse per parameter. */
	<
		const N extends string,
		P extends Record<string, ValueType<any>>,
		R,
		I extends { [K in keyof P]?: unknown } = {},
	>(
		name: N,
		spec: {
			params: P;
			returns: ValueType<R>;
			impl: (args: ParamsOf<P>) => In<R>;
			body?: never;
			inverse?: I & {
				[K in keyof P]?: (args: { result: R } & ParamsOf<P>) => In<P[K]["~v"]>;
			};
		},
	): Fn<N, P, R, InvFlags<P, I>>;
	/** An expression-bodied function: no `impl`, no `inverse`; each parameter's inverse is derived from the body. */
	<
		const N extends string,
		P extends Record<string, ValueType<any>>,
		R,
		B extends Ex<any>,
	>(
		name: N,
		spec: {
			params: P;
			returns: ValueType<R>;
			body: (
				params: BodyParams<P>,
			) => B &
				(Eval<NodeIn<B>, never> extends In<R>
					? unknown
					: { "~error": "the body's type doesn't match returns" });
			impl?: never;
			inverse?: never;
		},
	): Fn<N, P, R, DerivedInvFlags<P, NodeIn<B>>>;
	/** An incremental aggregate, such as `sum`: the engine adds and removes one value at a time. */
	aggregate<A, V, R>(spec: {
		init: A;
		add(acc: A, v: V): A;
		remove(acc: A, v: V): A;
		result(acc: A): R;
	}): unknown;
}

export const fn: FnFactory = shell("fn");
