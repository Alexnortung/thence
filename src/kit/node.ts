import type { Decimal } from "../values";
import type { AnyEntity, AnyTrait, TraitInitial } from "./entity";
import type { BuilderExpr } from "./expr";
import type { Cfg, Def, Inp } from "./infer";
import type { AnyKit, EntityOf, Expand, MetaOf, RootOf } from "./kit";
import type {
	All,
	EnumDef,
	ExprType,
	Initial,
	ListT,
	MapT,
	OneOf,
	Optional,
	ValueType,
} from "./types";

export type ParamRef = readonly ["param", string];
export type ConfigIn<X, K extends AnyKit> = X extends () => infer Y
	? ConfigIn<Y, K>
	: X extends ExprType<infer V>
		? BuilderExpr | ParamRef | JsonOf<V>
		: X extends EnumDef
			? { enum: readonly { value: string; meta?: MetaOf<K> }[] } | string
			: X extends ValueType<infer V>
				? JsonOf<V> | ParamRef
				: X extends MapT<infer Y>
					? {
							readonly [key: string]:
								| NodeFor<Expand<Y, K>, K>
								| ComponentNode<K>;
						}
					: X extends ListT<infer Y>
						? readonly (NodeFor<Expand<Y, K>, K> | ComponentNode<K>)[]
						: X extends AnyEntity | AnyTrait | OneOf<any> | All<any>
							? NodeFor<Expand<X, K>, K> | ComponentNode<K>
							: never;
export type JsonOf<V> = V extends Decimal ? string | number : V;

export type OptionalKeys<C> = {
	[M in keyof C]: C[M] extends Optional<any> ? M : never;
}[keyof C];
export type RequiredKeys<C> = Exclude<keyof C, OptionalKeys<C>>;
export type ConfigNode<C, K extends AnyKit> = {
	[M in RequiredKeys<C>]: ConfigIn<C[M], K>;
} & {
	[M in OptionalKeys<C>]?: C[M] extends Optional<infer Y>
		? ConfigIn<Y, K>
		: never;
};
export type ConfigPart<E, K extends AnyKit> = [
	RequiredKeys<Cfg<Def<E>>>,
] extends [never]
	? { config?: ConfigNode<Cfg<Def<E>>, K> }
	: { config: ConfigNode<Cfg<Def<E>>, K> };

export type InputIn<X, K extends AnyKit> =
	X extends ListT<infer Y>
		?
				| {
						template?: Template<Expand<Y, K>, K>;
						initial?: readonly InitialRow<Expand<Y, K>, K>[];
				  }
				| readonly InitialRow<Expand<Y, K>, K>[]
		: X extends MapT<infer Y>
			? {
					template?: Template<Expand<Y, K>, K>;
					initial?: { readonly [key: string]: Overlay<Expand<Y, K>, K> };
				}
			: X extends Initial<infer V> | ValueType<infer V>
				? JsonOf<V>
				: X extends TraitInitial<any, any>
					? { type: string }
					: never;
export type Template<E, K extends AnyKit> = E extends AnyEntity
	? Omit<ConfigPart<E, K>, never> & { inputs?: InputOverrides<E, K> }
	: never;
/** A starting row: an id for paths, laid over the template key by key. */
export type InitialRow<E, K extends AnyKit> = Overlay<E, K> & { id?: string };
/**
 * The overlay rule: like a node, but without `type`, and every part optional.
 * TypeScript can't see which fields the template has, so "no field the template lacks"
 * and "no change of type" are the checker's diagnostics, not compile errors.
 */
export type Overlay<E, K extends AnyKit> = E extends AnyEntity
	? {
			meta?: MetaOf<K>;
			config?: { [M in keyof Cfg<Def<E>>]?: OverlayIn<Cfg<Def<E>>[M], K> };
			inputs?: InputOverrides<E, K>;
		}
	: never;
export type OverlayIn<X, K extends AnyKit> = X extends () => infer Y
	? OverlayIn<Y, K>
	: X extends Optional<infer Y>
		? OverlayIn<Y, K>
		: X extends MapT<infer Y>
			? { readonly [key: string]: Overlay<Expand<Y, K>, K> }
			: X extends ListT<infer Y>
				? readonly Overlay<Expand<Y, K>, K>[]
				: X extends AnyEntity | AnyTrait | OneOf<any> | All<any>
					? Overlay<Expand<X, K>, K>
					: ConfigIn<X, K>;
export type InputOverrides<E, K extends AnyKit> = {
	[M in keyof Inp<Def<E>>]?: InputIn<Inp<Def<E>>[M], K>;
};

export type NodeFor<E, K extends AnyKit> = E extends AnyEntity
	? {
			type: E["name"];
			meta?: MetaOf<K>;
			inputs?: InputOverrides<E, K>;
		} & ConfigPart<E, K>
	: never;
export type ComponentNode<K extends AnyKit> = {
	use: string;
	params?: Record<string, unknown>;
	meta?: MetaOf<K>;
};
export type NodeOf<K extends AnyKit> =
	| NodeFor<EntityOf<K>, K>
	| ComponentNode<K>;
export type PlacementOf<K extends AnyKit> = NodeFor<EntityOf<K>, K>;

export type ProgramTree<K extends AnyKit> = ConfigPart<RootOf<K>, K> & {
	inputs?: InputOverrides<RootOf<K>, K>;
	functions?: Record<string, { params: readonly string[]; body: BuilderExpr }>;
	components?: Record<
		string,
		{ params?: Record<string, string | { expr: string }>; body: NodeOf<K> }
	>;
};

export interface ProgramBuilder<K extends AnyKit> {
	root: Placed<K>;
	define(
		name: string,
		f: { params: readonly string[]; body: BuilderExpr },
	): void;
	component(
		name: string,
		c: { params?: Record<string, unknown>; body: NodeOf<K> },
	): void;
}
export interface Placed<K extends AnyKit> {
	add(
		slot: string,
		name: string,
		placement: PlacementOf<K>,
		opts?: { meta?: MetaOf<K> },
	): Placed<K>;
	use(
		slot: string,
		name: string,
		component: string,
		params?: Record<string, unknown>,
	): Placed<K>;
}
