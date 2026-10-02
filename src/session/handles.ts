import type { ConditionalKeys, IsNever } from "type-fest";
import type {
	AnyEntity,
	AnyKit,
	AnyTrait,
	Cfg,
	Def,
	Der,
	DerivedEntity,
	EntityOf,
	Ex,
	Expand,
	ExprType,
	Impl,
	ImplNames,
	In,
	Initial,
	Inp,
	KnownN,
	ListT,
	MapT,
	MemberIsWritable,
	MemberValue,
	MetaOf,
	Optional,
	RootOf,
	ValueOfType,
	ValueType,
} from "../kit";
import type { Op } from "../log";
import { shell } from "../shell";
import type { Result } from "../values";
import type { Issue, Segment } from "./session";

/**
 * A handle to one value member, read-only.
 *
 * @typeParam V - the value it holds
 */
export interface Member<V> {
	/** The current value, or the error that stopped it being computed. The same object until the value changes. */
	get(): Result<V>;
	/** Calls `listener` after each change. Returns the unsubscribe. */
	subscribe(listener: () => void): () => void;
	/** What the checks on the member's type found. */
	issues(): readonly Issue[];
}
/**
 * A handle to a value member the Operator can set: an input, or a writable derived value.
 *
 * @typeParam V - the value it holds
 */
export interface InputMember<V> extends Member<V> {
	/** Sets the value, through the inverses down to the input for a derived value, and returns the op. */
	set(v: In<V>): Result<Op>;
	/** Goes back to the initial value, or `null`. */
	clear(): Op;
	/** Whether `set` works. TypeScript knows for your own formulas; this tells you for a value whose formula the Builder wrote. */
	writable(): boolean;
	/** Whether the Operator has changed the input from its initial value. */
	isSet(): boolean;
}
/**
 * The handle `member()` returns: with `set` when the member is writable, without it otherwise.
 *
 * @typeParam V - the value it holds
 * @typeParam W - whether it is writable, from MemberIsWritable
 */
export type MemberHandle<V, W> = W extends true
	? InputMember<V>
	: Member<V> & { writable(): false };

/**
 * The kind of a config or input member, from its type: a list of values is a
 * value; a list of entities is a list.
 *
 * @typeParam X - the member's type
 */
export type ValueKind<X> = X extends () => infer Y
	? ValueKind<Y>
	: X extends Initial<any> | ValueType<any> | ExprType<any> | Optional<any>
		? "value"
		: X extends ListT<infer Y>
			? Y extends ValueType<any>
				? "value"
				: "list"
			: X extends MapT<any>
				? "map"
				: "entity";
/**
 * The kind of a derived member: an entity when the expression creates one with `e.entity`, else a value.
 *
 * @typeParam X - the derived member's expression
 */
export type DerivedKind<X> =
	X extends Ex<KnownN<infer V>>
		? V extends DerivedEntity<any>
			? "entity"
			: "value"
		: "value";
/**
 * The kind of any member: "value", "entity", "list" or "map".
 *
 * @typeParam D - the entity's parts, from Def
 * @typeParam M - the member's name
 */
export type KindOf<D, M> = M extends keyof Inp<D>
	? ValueKind<Inp<D>[M]>
	: M extends keyof Cfg<D>
		? ValueKind<Cfg<D>[M]>
		: M extends keyof Der<D>
			? DerivedKind<Der<D>[M]>
			: never;
/**
 * Each member of an entity, with its kind: "value", "entity", "list" or "map".
 *
 * @typeParam E - the entity
 */
export type MemberKinds<E> = { [M in MemberNamesOf<E>]: KindOf<Def<E>, M> };
/**
 * The names of an entity's members of one kind, such as every list for `list()`.
 *
 * @typeParam E - the entity
 * @typeParam Kd - the kind
 */
export type MembersOfKind<E, Kd> = ConditionalKeys<MemberKinds<E>, Kd> & string;
/**
 * A member's type as the entity declares it; for a derived entity, the entity it creates.
 *
 * @typeParam E - the entity
 * @typeParam M - the member's name
 */
export type MemberType<E, M> = M extends keyof Inp<Def<E>>
	? Inp<Def<E>>[M]
	: M extends keyof Cfg<Def<E>>
		? Cfg<Def<E>>[M]
		: M extends keyof Der<Def<E>>
			? Der<Def<E>>[M] extends Ex<KnownN<infer V>>
				? V
				: never
			: never;
/**
 * The element type of a list or map member type.
 *
 * @typeParam X - the member's type
 */
export type ElemType<X> = X extends () => infer Y
	? ElemType<Y>
	: X extends ListT<infer Y> | MapT<infer Y>
		? Y
		: never;
/**
 * The traits an entity implements.
 *
 * @typeParam E - the entity
 */
export type ImplementedTraits<E> =
	Def<E> extends { impls: infer Im extends readonly unknown[] }
		? Im[number] extends infer I
			? I extends Impl<infer T>
				? T
				: never
			: never
		: never;

/**
 * True when every handle in the union implements the trait named N, so `as` needs no `has` first.
 *
 * @typeParam H - a handle, or a union of handles
 * @typeParam N - the trait's name
 */
export type EveryImplements<H, N> = IsNever<
	H extends { readonly "~impl": infer I } ? (N extends I ? never : H) : never
>;
/**
 * The value members every entity in a union of handles has.
 *
 * @typeParam H - a handle, or a union of handles
 */
export type CommonValueMembers<H> = (
	H extends { readonly "~entity": infer X }
		? (names: MembersOfKind<X, "value">) => void
		: never
) extends (names: infer I) => void
	? I & string
	: never;
/**
 * A handle to one instance of an entity. A member is reached by its kind:
 * `member` for values, `entity` for a single entity, `list` and `map` for
 * collections, so each returns the right handle.
 *
 * @typeParam E - the entity
 * @typeParam K - the kit, for the entities trait-typed members may hold
 */
export interface EntityHandle<E extends AnyEntity, K extends AnyKit> {
	/** The entity's name: switch on it to narrow a union of handles. */
	readonly type: E["name"];
	/** Stable for the life of the instance: a row keeps its id when rows move. */
	readonly id: string;
	/** The node's meta, as the Builder wrote it. */
	readonly meta: MetaOf<K>;
	/** The entity that holds this one; `undefined` for the root. */
	readonly parent: Handle<EntityOf<K>, K> | undefined;
	/** The names of the traits it implements, for `has` and `as`; type level only. */
	readonly "~impl": ImplNames<E>;
	/** The entity, so methods called on a union of handles can see each one; type level only. */
	readonly "~entity": E;
	/**
	 * Like as(), the signature doesn't mention E, so it works on a union of handles:
	 * the name must be a value member of every entity in the union, and the result is the union of their member handles.
	 */
	member<
		H extends { readonly "~entity": AnyEntity },
		M extends CommonValueMembers<H>,
	>(
		this: H,
		m: M,
	): H extends { readonly "~entity": infer X }
		? MemberHandle<MemberValue<Def<X>, M>, MemberIsWritable<Def<X>, M>>
		: never;
	/**
	 * Read through a trait the entity implements. The signature doesn't mention E, so it can be
	 * called on a union of handles, such as everything a t.oneOf(TField, …) holds after has().
	 */
	as<T extends AnyTrait, H extends { readonly "~impl": string }>(
		this: H,
		trait: T & (EveryImplements<H, T["name"]> extends true ? unknown : never),
	): TraitHandle<T, K>;
	/**
	 * A member that holds one entity, such as `customer: TPerson.initial(EPersonField)`.
	 * A trait-typed member gives a union of handles to the entities that implement it.
	 */
	entity<M extends MembersOfKind<E, "entity">>(
		m: M,
	): Handle<Expand<MemberType<E, M>, K>, K>;
	/** A member that holds a list of entities, such as `rows: t.list(EItem)`. */
	list<M extends MembersOfKind<E, "list">>(
		m: M,
	): ListHandle<Expand<ElemType<MemberType<E, M>>, K>, K>;
	/** A member that holds a map of entities, such as `lines: t.map(TPriced)`. */
	map<M extends MembersOfKind<E, "map">>(
		m: M,
	): MapHandle<Expand<ElemType<MemberType<E, M>>, K>, K>;
	/** The issues of every member of this entity and the entities it holds. */
	issues(): readonly Issue[];
}
/**
 * A handle that reads an entity through a trait, made by `as(TPriced)`. It sees
 * the trait's members as the entity implements them, never the entity's own.
 *
 * @typeParam T - the trait
 * @typeParam K - the kit
 */
export interface TraitHandle<T extends AnyTrait, K extends AnyKit> {
	/** A value member of the trait. */
	member<M extends keyof T["~members"] & string>(
		m: M,
	): Member<ValueOfType<T["~members"][M]>>;
	/** A member of the trait that holds an entity. */
	entity<M extends keyof T["~members"] & string>(
		m: M,
	): Handle<Expand<T["~members"][M], K>, K>;
}
/**
 * A handle to a list of entities. Rows are found by id, which survives moves;
 * positions are only for display.
 *
 * @typeParam E - the entities the list may hold
 * @typeParam K - the kit
 */
export interface ListHandle<E, K extends AnyKit> {
	/** Adds a row at the end, from the template. */
	add(): Handle<E, K>;
	/** Adds a row at `index`, from the template. */
	insert(index: number): Handle<E, K>;
	move(id: string, index: number): void;
	remove(id: string): void;
	at(index: number): Handle<E, K> | undefined;
	/** Every row with its id, in order. */
	entries(): [id: string, handle: Handle<E, K>][];
}
/**
 * A handle to an ordered map of entities, keyed by name.
 *
 * @typeParam E - the entities the map may hold
 * @typeParam K - the kit
 */
export interface MapHandle<E, K extends AnyKit> {
	/** Adds an entry under a new key, from the template. */
	add(key: string): Handle<E, K>;
	get(key: string): Handle<E, K> | undefined;
	remove(key: string): void;
	/** Every entry with its key, in order. */
	entries(): [key: string, handle: Handle<E, K>][];
}

/**
 * The handle for an entity or a trait. A union of entities gives a union of
 * handles, narrowed with `has` or a switch on `type`.
 *
 * @typeParam X - an entity, a union of entities, or a trait
 * @typeParam K - the kit, for the entities trait-typed members may hold
 */
export type Handle<X, K extends AnyKit> = X extends AnyEntity
	? EntityHandle<X, K>
	: X extends AnyTrait
		? TraitHandle<X, K>
		: never;

/** Narrows a union of handles to those that implement the trait. */
export const has: <H extends { "~impl": string }, T extends AnyTrait>(
	h: H,
	trait: T,
) => h is H extends any ? (T["name"] extends H["~impl"] ? H : never) : never =
	shell("has");

// ---------- session.at: walk a path through the kit ----------

/** Where a path has got to: an entity, a collection, or a value. */
export type Pos =
	| { ent: AnyEntity }
	| { coll: unknown; kind: "list" | "map" }
	| { value: unknown };
/**
 * One step of a path from an entity, by member name.
 *
 * @typeParam E - the entity
 * @typeParam S - the segment
 * @typeParam K - the kit
 */
export type StepEntity<E, S, K extends AnyKit> = E extends AnyEntity
	? S extends MemberNamesOf<E>
		? KindOf<Def<E>, S> extends "list" | "map"
			? { coll: Expand<ElemType<MemberType<E, S>>, K>; kind: KindOf<Def<E>, S> }
			: KindOf<Def<E>, S> extends "entity"
				? { ent: Expand<MemberType<E, S>, K> }
				: KindOf<Def<E>, S> extends "value"
					? { value: MemberValue<Def<E>, S> }
					: never
		: never
	: never;
/**
 * Every member name of an entity.
 *
 * @typeParam E - the entity
 */
export type MemberNamesOf<E> = (
	| keyof Inp<Def<E>>
	| keyof Cfg<Def<E>>
	| keyof Der<Def<E>>
) &
	string;
/**
 * Follows a path segment by segment. A segment after a collection takes a row
 * by position or id, whichever it is.
 *
 * @typeParam P - where the path has got to
 * @typeParam Ss - the segments left
 * @typeParam K - the kit
 */
export type Walk<
	P extends Pos,
	Ss extends readonly Segment[],
	K extends AnyKit,
> = Ss extends readonly [infer S, ...infer Rest extends readonly Segment[]]
	? P extends { ent: infer E }
		? Walk<Merge<StepEntity<E, S, K>>, Rest, K>
		: P extends { coll: infer X }
			? Walk<{ ent: Extract<X, AnyEntity> }, Rest, K>
			: never
	: P;
/**
 * Collapses the positions a step from a union of entities gives into one.
 *
 * @typeParam P - the positions
 */
export type Merge<P> =
	IsNever<P> extends true
		? never
		: P extends { ent: any }
			? { ent: P["ent"] }
			: P;
/**
 * The handle for where a path ended.
 *
 * @typeParam P - the position
 * @typeParam K - the kit
 */
export type Out<P, K extends AnyKit> = P extends { ent: infer E }
	? Handle<E, K>
	: P extends { coll: infer X; kind: "list" }
		? ListHandle<X, K>
		: P extends { coll: infer X; kind: "map" }
			? MapHandle<X, K>
			: P extends { value: infer V }
				? Member<V>
				: never;
/**
 * The handle a path from the root names, as `session.at(path)` returns it.
 *
 * @typeParam K - the kit
 * @typeParam P - the path's segments
 */
export type At<K extends AnyKit, P extends readonly Segment[]> = Out<
	Walk<{ ent: RootOf<K> }, P, K>,
	K
>;
