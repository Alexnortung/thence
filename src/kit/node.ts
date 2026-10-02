import type { ConditionalKeys, IsNever, Simplify } from "type-fest";
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

/** Inside a component's body: the value of one of the component's parameters. */
export type ParamRef = readonly ["param", string];
/**
 * What a Builder writes for one config member in a program tree.
 *
 * @typeParam X - the member's type
 * @typeParam K - the kit, for the entities a member may place
 */
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
/**
 * How a value is written in a program's JSON: a decimal as a string or a number.
 *
 * @typeParam V - the value type
 */
export type JsonOf<V> = V extends Decimal ? string | number : V;

/**
 * The config members a Builder may leave out.
 *
 * @typeParam C - an entity's config members
 */
export type OptionalKeys<C> = ConditionalKeys<C, Optional<any>>;
/**
 * The config members a Builder must set.
 *
 * @typeParam C - an entity's config members
 */
export type RequiredKeys<C> = Exclude<keyof C, OptionalKeys<C>>;
/**
 * A placement's `config` object.
 *
 * @typeParam C - the entity's config members
 * @typeParam K - the kit
 */
export type ConfigNode<C, K extends AnyKit> = {
	[M in RequiredKeys<C>]: ConfigIn<C[M], K>;
} & {
	[M in OptionalKeys<C>]?: C[M] extends Optional<infer Y>
		? ConfigIn<Y, K>
		: never;
};
/**
 * The `config` key of a placement: required when the entity has a required config member.
 *
 * @typeParam E - the entity placed
 * @typeParam K - the kit
 */
export type ConfigPart<E, K extends AnyKit> =
	IsNever<RequiredKeys<Cfg<Def<E>>>> extends true
		? { config?: ConfigNode<Cfg<Def<E>>, K> }
		: { config: ConfigNode<Cfg<Def<E>>, K> };

/**
 * What a Builder writes to override one input's initial value. A list or map
 * input takes a template and starting rows.
 *
 * @typeParam X - the input's type
 * @typeParam K - the kit
 */
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
/**
 * The template every row of a list or map input starts from.
 *
 * @typeParam E - the entity each row is
 * @typeParam K - the kit
 */
export type Template<E, K extends AnyKit> = E extends AnyEntity
	? Omit<ConfigPart<E, K>, never> & { inputs?: InputOverrides<E, K> }
	: never;
/**
 * A starting row: an id for paths, laid over the template key by key.
 *
 * @typeParam E - the entity each row is
 * @typeParam K - the kit
 */
export type InitialRow<E, K extends AnyKit> = Overlay<E, K> & { id?: string };
/**
 * The overlay rule: like a node, but without `type`, and every part optional.
 * TypeScript can't see which fields the template has, so "no field the template lacks"
 * and "no change of type" are the checker's diagnostics, not compile errors.
 *
 * @typeParam E - the entity the overlay is laid on
 * @typeParam K - the kit
 */
export type Overlay<E, K extends AnyKit> = E extends AnyEntity
	? {
			meta?: MetaOf<K>;
			config?: { [M in keyof Cfg<Def<E>>]?: OverlayIn<Cfg<Def<E>>[M], K> };
			inputs?: InputOverrides<E, K>;
		}
	: never;
/**
 * One config member inside an {@link Overlay}: overlays all the way down.
 *
 * @typeParam X - the member's type
 * @typeParam K - the kit
 */
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
/**
 * A placement's `inputs` object: any input's initial value, overridden.
 *
 * @typeParam E - the entity placed
 * @typeParam K - the kit
 */
export type InputOverrides<E, K extends AnyKit> = {
	[M in keyof Inp<Def<E>>]?: InputIn<Inp<Def<E>>[M], K>;
};

/**
 * A placement of one entity in a program tree: `{ type, meta?, config?, inputs? }`.
 *
 * @typeParam E - the entity, or a union of entities for a union of placements
 * @typeParam K - the kit
 */
export type NodeFor<E, K extends AnyKit> = E extends AnyEntity
	? Simplify<
			{
				type: E["name"];
				meta?: MetaOf<K>;
				inputs?: InputOverrides<E, K>;
			} & ConfigPart<E, K>
		>
	: never;
/**
 * A placement of a Builder-defined component, by name.
 *
 * @typeParam K - the kit, for the type of `meta`
 */
export type ComponentNode<K extends AnyKit> = {
	use: string;
	params?: Record<string, unknown>;
	meta?: MetaOf<K>;
};
/**
 * Anything a Builder can place in this kit: any of its entities, or a component.
 *
 * @typeParam K - the kit
 */
export type NodeOf<K extends AnyKit> =
	| NodeFor<EntityOf<K>, K>
	| ComponentNode<K>;
/**
 * A placement of one of the kit's entities, without components.
 *
 * @typeParam K - the kit
 */
export type PlacementOf<K extends AnyKit> = NodeFor<EntityOf<K>, K>;

/**
 * A whole program as one object, for `kit.program(tree)`: the root's config
 * and inputs, plus the Builder's functions and components.
 *
 * @typeParam K - the kit
 */
export type ProgramTree<K extends AnyKit> = ConfigPart<RootOf<K>, K> & {
	inputs?: InputOverrides<RootOf<K>, K>;
	functions?: Record<string, { params: readonly string[]; body: BuilderExpr }>;
	components?: Record<
		string,
		{ params?: Record<string, string | { expr: string }>; body: NodeOf<K> }
	>;
};

/**
 * The step-by-step way to build a program: `root.add(…)`, `define`, `component`.
 *
 * @typeParam K - the kit
 */
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
/**
 * A placed node, to place more under it. `add` and `use` return the new child.
 *
 * @typeParam K - the kit
 */
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
