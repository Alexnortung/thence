import { shell } from "../shell";

import type { CallN, Ex, NodeIn, ParamN } from "./expr";
import type { Eval, OneWritable } from "./infer";
import type { In, ValueType } from "./types";

export type ParamsOf<P extends Record<string, ValueType<any>>> = {
	[K in keyof P]: P[K]["~v"];
};
export interface Fn<
	N extends string,
	P extends Record<string, ValueType<any>>,
	R,
	Inv extends readonly boolean[],
> {
	readonly "~kind": "fn";
	readonly name: N;
	readonly "~params": P;
	readonly "~ret": R;
	readonly "~inv": Inv;
}
export type InvFlags<P, I> = {
	[K in keyof P]: K extends keyof I ? true : false;
};
// Object key order isn't a tuple, so the spike can only map inverses for one-parameter functions exactly.
export type InvTuple<
	P extends Record<string, unknown>,
	I,
> = keyof P extends infer K ? (K extends keyof I ? [true] : [false]) : never;

/** The body's parameters, one expression each, as `e.fn((row) => …)` gets its row. */
export type BodyParams<P extends Record<string, ValueType<any>>> = {
	[K in keyof P]: Ex<ParamN<K & string, P[K]["~v"]>>;
};
/** Whether the body is writable through parameter K, with the other parameters fixed. */
export type ParamWritable<N, K> =
	N extends ParamN<infer K2, any>
		? [K2] extends [K]
			? true
			: false
		: N extends CallN<infer S, infer A>
			? OneWritable<{ [I in keyof A]: ParamWritable<A[I], K> }, S["inv"]>
			: false;
// Same limit as InvTuple: exact for one-parameter functions.
export type DerivedInvTuple<
	P extends Record<string, unknown>,
	N,
> = keyof P extends infer K
	? K extends keyof P
		? [ParamWritable<N, K>]
		: never
	: never;

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
	): Fn<N, P, R, InvTuple<P, I>>;
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
	): Fn<N, P, R, DerivedInvTuple<P, NodeIn<B>>>;
	/** An incremental aggregate, such as `sum`: the engine adds and removes one value at a time. */
	aggregate<A, V, R>(spec: {
		init: A;
		add(acc: A, v: V): A;
		remove(acc: A, v: V): A;
		result(acc: A): R;
	}): unknown;
}

export const fn: FnFactory = shell("fn");
