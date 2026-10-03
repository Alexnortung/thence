import type { Ex, Expr } from "./expr";
import type { MemberValue } from "./infer";
import type {
	ConfigDef,
	In,
	Initial,
	MemberDef,
	ResolvedMember,
	ValueType,
} from "./types";

/**
 * A trait: a contract several entities can implement in their own way, such as
 * `TPriced` with a `total`. Code that only needs the contract reads through
 * the trait and works with every entity that implements it.
 *
 * @typeParam N - the trait's name, unique in the kit
 * @typeParam M - its members by name, each with its {@link MemberDef | member type}
 * @typeParam D - the names of the members that have a default, which an impl may leave out
 */
export interface Trait<
	N extends string = string,
	M extends Record<string, MemberDef> = any,
	D extends PropertyKey = any,
> {
	readonly "~kind": "trait";
	readonly name: N;
	readonly "~members": M;
	readonly "~defaults": D;
	/** The default expressions, by member name. */
	readonly defaults: Readonly<Record<string, Expr>>;
	/**
	 * The type of an input that holds any entity implementing this trait, starting
	 * as an instance of `entity`. The Operator may switch it to another entity
	 * that implements the trait, which starts a fresh instance:
	 * `customer: TPerson.initial(EPersonField)`. Use the entity itself
	 * (`customer: EPersonField`) when the entity must not change.
	 */
	initial<E extends AnyEntity>(entity: E): TraitInitial<Trait<N, M, D>, E>;
}
/** Any trait, for constraints. */
export type AnyTrait = Trait<string, any, any>;
/**
 * The member type `TPerson.initial(EPersonField)` returns; see {@link Trait.initial}.
 *
 * @typeParam T - the trait every entity the input holds must implement
 * @typeParam E - the entity the input starts as
 */
export interface TraitInitial<T extends AnyTrait, E extends AnyEntity> {
	readonly "~kind": "traitInitial";
	readonly "~trait": T;
	readonly "~entity": E;
}

/**
 * Defines a trait.
 *
 * @param name - unique in the kit; a path reads through the trait with `{"as": name}`
 * @param members - each member's type
 * @param defaults - an expression for any member an impl may leave out, such as
 *   `{ label: e.self("name") }`; an impl that gives the member overrides it
 */
export type TraitFactory = <
	const N extends string,
	const M extends Record<string, MemberDef>,
	D extends { [K in keyof M]?: Expr } = {},
>(
	name: N,
	members: M,
	defaults?: D,
) => Trait<N, M, keyof D>;

/**
 * What an impl must give: an expression for every member of the trait, except
 * those with a default, which it may give.
 *
 * @typeParam T - the trait being implemented
 */
export type ImplBody<T extends AnyTrait> = {
	[K in Exclude<keyof T["~members"], T["~defaults"]>]: Expr;
} & { [K in T["~defaults"] & keyof T["~members"]]?: Expr };
/**
 * How one entity implements a trait, made by `impl(TPriced, { total: … })` and
 * listed in the entity's `impls`.
 *
 * @typeParam T - the trait it implements
 */
export interface Impl<T extends AnyTrait> {
	readonly "~kind": "impl";
	readonly "~trait": T;
	readonly body: ImplBody<T>;
}
/** `impl(TPriced, { total: … })`: how an entity implements a trait. */
export type ImplFactory = <T extends AnyTrait>(
	trait: T,
	body: ImplBody<T>,
) => Impl<T>;

/** The parts of an entity, as {@link EntityFactory} takes them. */
export interface EntityDef {
	/** What the Builder sets when placing the entity: formulas, conditions and the entities it places. */
	config?: Record<string, ConfigDef>;
	/** What the Operator enters. Each input starts from an initial value, which the Builder may override. */
	inputs?: Record<string, MemberDef>;
	/** Values and entities the entity computes from expressions. */
	derived?: Record<string, Ex<any>>;
	/** How the entity implements each of its traits. */
	impls?: readonly Impl<any>[];
	/** Where a derived value in a cycle starts each time the cycle is computed; the type's zero otherwise. */
	seeds?: Record<string, unknown>;
}
/** An entity's members with every function called, as `membersOf(entity)` gives them to the checker. */
export interface EntityMembers {
	readonly config: Readonly<Record<string, ResolvedMember>>;
	readonly inputs: Readonly<Record<string, ResolvedMember>>;
	readonly derived: Readonly<Record<string, Ex<any>>>;
	/** Its impls, by trait name. */
	readonly impls: Readonly<Record<string, ImplMembers>>;
}
/** One impl as the checker reads it: every member of the trait, with its type and its expression. */
export interface ImplMembers {
	readonly trait: AnyTrait;
	/** Each member's type, by name. */
	readonly types: Readonly<Record<string, ResolvedMember>>;
	/** Each member's expression: the impl's, or else the trait's default. */
	readonly body: Readonly<Record<string, Expr>>;
}
/**
 * An entity: a kind of thing a program is built from, such as a quote, a line
 * item or a form field. It declares its own members and the traits it implements.
 *
 * @typeParam N - the entity's name, unique in the kit; a Builder places it as `{ type: N }`
 * @typeParam D - its parts, as {@link EntityFactory} inferred them
 */
export interface Entity<N extends string = string, D extends EntityDef = any> {
	readonly "~kind": "entity";
	readonly name: N;
	readonly "~def": D;
}
/** Any entity, for constraints. */
export type AnyEntity = Entity<string, any>;

/**
 * An input must start somewhere: an initial value, a nullable type, a collection
 * or a trait's initial entity. A value type with neither becomes an error type,
 * so the mistake shows on the input.
 *
 * @typeParam X - the input's member type
 */
export type CheckInput<X> =
	X extends Initial<any>
		? X
		: X extends ValueType<infer V>
			? null extends V
				? X
				: { error: "an input needs .initial(v) or a .nullable() type" }
			: X;

/**
 * Defines an entity. Each part is inferred exactly, so handles and paths know
 * every member's type.
 *
 * @typeParam N - the entity's name
 * @typeParam C - its config members and their types; a member may be a
 *   {@link Later} function naming an entity defined further down
 * @typeParam I - its inputs and their types
 * @typeParam Dv - its derived members and their expressions
 * @typeParam Im - its impls
 */
export type EntityFactory = <
	const N extends string,
	const C extends Record<string, ConfigDef> = {},
	const I extends Record<string, MemberDef> = {},
	const Dv extends Record<string, Ex<any>> = {},
	const Im extends readonly Impl<any>[] = [],
>(
	name: N,
	def: {
		config?: C;
		inputs?: { [K in keyof I]: CheckInput<I[K]> };
		derived?: Dv;
		impls?: Im;
		seeds?: {
			[K in keyof Dv & string]?: In<
				MemberValue<{ config: C; inputs: I; derived: Dv }, K>
			>;
		};
	},
) => Entity<N, { config: C; inputs: I; derived: Dv; impls: Im }>;
