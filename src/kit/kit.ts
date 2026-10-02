import type { AnyEntity, AnyTrait, Impl, TraitInitial } from "./entity";
import type { DerivedEntity } from "./expr";
import type { Fn, StdFn } from "./fn";
import type { Def } from "./infer";
import type { All, Meta, OneOf } from "./types";

/** What `kit()` takes. */
export interface KitSpec {
	name: string;
	/** Saved programs record it; a change that only adds stays compatible with them. */
	version: string;
	types?: Record<string, unknown>;
	/** The functions Builders may call, by name: usually `{ ...std, ...yourOwn }`. */
	functions?: Record<string, KitFn>;
	/** The entity every program starts from. */
	root: AnyEntity;
	/** Every entity a Builder may place, the root included. */
	entities: readonly AnyEntity[];
	/** The type of every node's `meta`, from `t.meta<M>()`. */
	meta?: Meta<any>;
}
/** A function a kit offers: one of yours from `fn()`, or one of `std`. */
export type KitFn = Fn<string, any, any, any> | StdFn;

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
