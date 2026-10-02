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
	RegisteredKit,
	RootOf,
	ValueOfType,
	ValueType,
} from "../kit";
import type { Op } from "../log";
import { shell } from "../shell";
import type { Result } from "../values";
import type { Issue, Segment } from "./session";

export interface Member<V> {
	get(): Result<V>;
	subscribe(listener: () => void): () => void;
	issues(): readonly Issue[];
}
export interface InputMember<V> extends Member<V> {
	set(v: In<V>): Result<Op>;
	clear(): Op;
	writable(): boolean;
	isSet(): boolean;
}
export type MemberHandle<V, W> = W extends true
	? InputMember<V>
	: Member<V> & { writable(): false };

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
export type DerivedKind<X> =
	X extends Ex<KnownN<infer V>>
		? V extends DerivedEntity<any>
			? "entity"
			: "value"
		: "value";
export type KindOf<D, M> = M extends keyof Inp<D>
	? ValueKind<Inp<D>[M]>
	: M extends keyof Cfg<D>
		? ValueKind<Cfg<D>[M]>
		: M extends keyof Der<D>
			? DerivedKind<Der<D>[M]>
			: never;
/** Each member of an entity, with its kind: "value", "entity", "list" or "map". */
export type MemberKinds<E> = { [M in MemberNamesOf<E>]: KindOf<Def<E>, M> };
export type MembersOfKind<E, Kd> = ConditionalKeys<MemberKinds<E>, Kd> & string;
export type MemberType<E, M> = M extends keyof Inp<Def<E>>
	? Inp<Def<E>>[M]
	: M extends keyof Cfg<Def<E>>
		? Cfg<Def<E>>[M]
		: M extends keyof Der<Def<E>>
			? Der<Def<E>>[M] extends Ex<KnownN<infer V>>
				? V
				: never
			: never;
export type ElemType<X> = X extends () => infer Y
	? ElemType<Y>
	: X extends ListT<infer Y> | MapT<infer Y>
		? Y
		: never;
export type ImplementedTraits<E> =
	Def<E> extends { impls: infer Im extends readonly unknown[] }
		? Im[number] extends infer I
			? I extends Impl<infer T>
				? T
				: never
			: never
		: never;

/** true when every handle in the union implements the trait named N (so `as` needs no `has` first) */
export type EveryImplements<H, N> = IsNever<
	H extends { readonly "~impl": infer I } ? (N extends I ? never : H) : never
>;
/** the value members every entity in a union of handles has */
export type CommonValueMembers<H> = (
	H extends { readonly "~entity": infer X }
		? (names: MembersOfKind<X, "value">) => void
		: never
) extends (names: infer I) => void
	? I & string
	: never;
export interface EntityHandle<E extends AnyEntity, K extends AnyKit> {
	readonly type: E["name"];
	readonly id: string;
	readonly meta: MetaOf<K>;
	readonly parent: Handle<EntityOf<K>, K> | undefined;
	readonly "~impl": ImplNames<E>;
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
	entity<M extends MembersOfKind<E, "entity">>(
		m: M,
	): Handle<Expand<MemberType<E, M>, K>, K>;
	list<M extends MembersOfKind<E, "list">>(
		m: M,
	): ListHandle<Expand<ElemType<MemberType<E, M>>, K>, K>;
	map<M extends MembersOfKind<E, "map">>(
		m: M,
	): MapHandle<Expand<ElemType<MemberType<E, M>>, K>, K>;
	issues(): readonly Issue[];
}
export interface TraitHandle<T extends AnyTrait, K extends AnyKit> {
	member<M extends keyof T["~members"] & string>(
		m: M,
	): Member<ValueOfType<T["~members"][M]>>;
	entity<M extends keyof T["~members"] & string>(
		m: M,
	): Handle<Expand<T["~members"][M], K>, K>;
}
export interface ListHandle<E, K extends AnyKit> {
	add(): Handle<E, K>;
	insert(index: number): Handle<E, K>;
	move(id: string, index: number): void;
	remove(id: string): void;
	at(index: number): Handle<E, K> | undefined;
	entries(): [id: string, handle: Handle<E, K>][];
}
export interface MapHandle<E, K extends AnyKit> {
	add(key: string): Handle<E, K>;
	get(key: string): Handle<E, K> | undefined;
	remove(key: string): void;
	entries(): [key: string, handle: Handle<E, K>][];
}

export type Handle<X, K extends AnyKit = RegisteredKit> = X extends AnyEntity
	? EntityHandle<X, K>
	: X extends AnyTrait
		? TraitHandle<X, K>
		: never;

export const has: <H extends { "~impl": string }, T extends AnyTrait>(
	h: H,
	trait: T,
) => h is H extends any ? (T["name"] extends H["~impl"] ? H : never) : never =
	shell("has");

// ---------- session.at: walk a path through the kit ----------

export type Pos =
	| { ent: AnyEntity }
	| { coll: unknown; kind: "list" | "map" }
	| { value: unknown };
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
export type MemberNamesOf<E> = (
	| keyof Inp<Def<E>>
	| keyof Cfg<Def<E>>
	| keyof Der<Def<E>>
) &
	string;
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
/** union of positions from a union of entities, collapsed */
export type Merge<P> =
	IsNever<P> extends true
		? never
		: P extends { ent: any }
			? { ent: P["ent"] }
			: P;
export type Out<P, K extends AnyKit> = P extends { ent: infer E }
	? Handle<E, K>
	: P extends { coll: infer X; kind: "list" }
		? ListHandle<X, K>
		: P extends { coll: infer X; kind: "map" }
			? MapHandle<X, K>
			: P extends { value: infer V }
				? Member<V>
				: never;
export type At<K extends AnyKit, P extends readonly Segment[]> = Out<
	Walk<{ ent: RootOf<K> }, P, K>,
	K
>;
