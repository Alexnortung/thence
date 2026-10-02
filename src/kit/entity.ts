import { shell } from "../shell";
import type { Ex, Expr } from "./expr";
import type { Initial, ValueType } from "./types";

export interface Trait<
	N extends string = string,
	M extends Record<string, unknown> = any,
	D extends PropertyKey = any,
> {
	readonly "~kind": "trait";
	readonly name: N;
	readonly "~members": M;
	readonly "~defaults": D;
	/** a trait-typed input: the Operator may switch to any entity that implements the trait */
	initial<E extends AnyEntity>(entity: E): TraitInitial<Trait<N, M, D>, E>;
}
export type AnyTrait = Trait<string, any, any>;
export interface TraitInitial<T extends AnyTrait, E extends AnyEntity> {
	readonly "~kind": "traitInitial";
	readonly "~trait": T;
	readonly "~entity": E;
}

export const trait: <
	const N extends string,
	const M extends Record<string, unknown>,
	D extends { [K in keyof M]?: Expr } = {},
>(
	name: N,
	members: M,
	defaults?: D,
) => Trait<N, M, keyof D> = shell("trait");

export type ImplBody<T extends AnyTrait> = {
	[K in Exclude<keyof T["~members"], T["~defaults"]>]: Expr;
} & { [K in T["~defaults"] & keyof T["~members"]]?: Expr };
export interface Impl<T extends AnyTrait> {
	readonly "~kind": "impl";
	readonly "~trait": T;
}
export const impl: <T extends AnyTrait>(
	trait: T,
	body: ImplBody<T>,
) => Impl<T> = shell("impl");

export interface EntityDef {
	config?: Record<string, unknown>;
	inputs?: Record<string, unknown>;
	derived?: Record<string, Ex<any>>;
	impls?: readonly Impl<any>[];
	seeds?: Record<string, unknown>;
}
export interface Entity<N extends string = string, D extends EntityDef = any> {
	readonly "~kind": "entity";
	readonly name: N;
	readonly "~def": D;
}
export type AnyEntity = Entity<string, any>;

/** An input must start somewhere: an initial value, a nullable type, a collection or a trait's initial entity. */
export type CheckInput<X> =
	X extends Initial<any>
		? X
		: X extends ValueType<infer V>
			? null extends V
				? X
				: { error: "an input needs .initial(v) or a .nullable() type" }
			: X;

export const entity: <
	const N extends string,
	const C extends Record<string, unknown> = {},
	const I extends Record<string, unknown> = {},
	const Dv extends Record<string, Ex<any>> = {},
	const Im extends readonly Impl<any>[] = [],
>(
	name: N,
	def: {
		config?: C;
		inputs?: { [K in keyof I]: CheckInput<I[K]> };
		derived?: Dv;
		impls?: Im;
		seeds?: Record<string, unknown>;
	},
) => Entity<N, { config: C; inputs: I; derived: Dv; impls: Im }> =
	shell("entity");
