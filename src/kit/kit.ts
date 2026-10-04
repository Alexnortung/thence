import type { IsNever } from "type-fest";
import type { AnyEntity, AnyTrait, Impl, TraitInitial } from "./entity";
import type { DerivedEntity } from "./expr";
import type { Fn } from "./fn";
import type { Cfg, Def } from "./infer";
import type { All, Later, MemberDef, Meta, OneOf } from "./types";

/** What `kit()` takes. */
export interface KitSpec {
	name: string;
	/** Saved programs record it; a change that only adds stays compatible with them. */
	version: string;
	types?: Record<string, unknown>;
	/**
	 * Your own functions Builders may call, by name. They come on top of the
	 * std functions, and one with a std function's name replaces it.
	 */
	functions?: Record<string, KitFn>;
	/**
	 * The std functions this kit offers, in place of all of `std`: `{}` for
	 * none, or `{ add: std.add, sum: std.sum }` for a few. Defaults to `std`.
	 */
	stdFunctions?: Record<string, KitFn>;
	/** The entity every program starts from. */
	root: AnyEntity;
	/** Every entity a Builder may place, the root included. */
	entities: readonly AnyEntity[];
	/** The type of every node's `meta`, from `t.meta<M>()`. */
	meta?: Meta<any>;
}
/** A function a kit offers: one of yours, or one of `std`, both made by `fn()`. */
export type KitFn = Fn<string, any, any, any>;

/**
 * What `kit()` returns, minus the methods that build and run programs. Those
 * need the checker and the session, so `src/index.ts` adds them; the kit
 * module only knows definitions.
 *
 * @typeParam S - the spec it was made from, exactly as written
 */
export interface KitDefinition<S extends KitSpec = KitSpec> {
	readonly "~spec": S;
	readonly name: S["name"];
}
/** Any kit, for constraints. */
export type AnyKit = KitDefinition<any>;

/**
 * The type of a node's `meta` in this kit, `unknown` when the kit doesn't say.
 *
 * @typeParam K - the kit
 */
export type MetaOf<K extends AnyKit> = K["~spec"] extends {
	meta: Meta<infer M>;
}
	? M
	: unknown;
/**
 * The union of the kit's entities.
 *
 * @typeParam K - the kit
 */
export type EntityOf<K extends AnyKit> = K["~spec"]["entities"][number];
/**
 * The kit's root entity.
 *
 * @typeParam K - the kit
 */
export type RootOf<K extends AnyKit> = K["~spec"]["root"];

/**
 * The names of the traits an entity implements.
 *
 * @typeParam E - the entity
 */
export type ImplNames<E> =
	Def<E> extends { impls: infer Im extends readonly unknown[] }
		? Im[number] extends infer I
			? I extends Impl<infer T>
				? T["name"]
				: never
			: never
		: never;
/**
 * The kit's entities that implement a trait.
 *
 * @typeParam T - the trait
 * @typeParam K - the kit
 */
export type Implementers<T extends AnyTrait, K extends AnyKit> =
	EntityOf<K> extends infer E
		? E extends AnyEntity
			? T["name"] extends ImplNames<E>
				? E
				: never
			: never
		: never;
/**
 * The kit's entities that implement every one of the traits, for `t.all`.
 *
 * @typeParam Ts - the traits
 * @typeParam K - the kit
 */
export type AllOf<
	Ts extends readonly AnyTrait[],
	K extends AnyKit,
> = Ts extends readonly [
	infer H extends AnyTrait,
	...infer R extends readonly AnyTrait[],
]
	? Extract<Implementers<H, K>, AllOf<R, K>>
	: EntityOf<K>;

/**
 * The entities a member type may hold: the entity itself, a trait's
 * implementers, or those of each option of `t.oneOf` and `t.all`.
 *
 * @typeParam X - the member type
 * @typeParam K - the kit, which knows who implements what
 */
export type Expand<X, K extends AnyKit> = X extends () => infer Y
	? Expand<Y, K>
	: X extends AnyEntity
		? X
		: X extends AnyTrait
			? Implementers<X, K>
			: X extends TraitInitial<infer T, any>
				? Implementers<T, K>
				: X extends OneOf<infer Xs>
					? Expand<Xs[number], K>
					: X extends All<infer Ts>
						? AllOf<Ts, K>
						: X extends DerivedEntity<infer E>
							? E
							: never;

/**
 * The names of the config members whose {@link Later} function doesn't
 * return a member type, in any of the entities.
 *
 * @typeParam E - the entities, as a union
 */
export type BadConfig<E> = E extends unknown
	? {
			[K in keyof Cfg<Def<E>>]: Cfg<Def<E>>[K] extends Later
				? ReturnType<Cfg<Def<E>>[K]> extends MemberDef
					? never
					: K
				: never;
		}[keyof Cfg<Def<E>>]
	: never;
/**
 * What `kit()` checks once every entity exists: that each config function
 * returns a member type. If one doesn't, `entities` is a type error naming
 * the member.
 *
 * @typeParam S - the kit's spec
 */
export type CheckConfig<S extends KitSpec> =
	IsNever<BadConfig<S["entities"][number]>> extends true
		? unknown
		: {
				readonly entities: {
					"~error": "a config member's function must return a member type";
					member: BadConfig<S["entities"][number]>;
				};
			};
