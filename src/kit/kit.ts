import type { AnyEntity, AnyTrait, Impl, TraitInitial } from "./entity";
import type { DerivedEntity } from "./expr";
import type { Def } from "./infer";
import type { All, Meta, OneOf } from "./types";

export interface KitSpec {
	name: string;
	version: string;
	types?: Record<string, unknown>;
	functions?: Record<string, unknown>;
	root: AnyEntity;
	entities: readonly AnyEntity[];
	meta?: Meta<any>;
}
/**
 * What \`kit()\` returns, minus the methods that build and run programs. Those
 * need the checker and the session, so \`src/index.ts\` adds them; the kit
 * module only knows definitions.
 */
export interface KitDefinition<S extends KitSpec = KitSpec> {
	readonly "~spec": S;
	readonly name: S["name"];
}
export type AnyKit = KitDefinition<any>;

/** Register your kit once so `Handle<typeof EItem>` can type trait-typed members without naming the kit. */
// biome-ignore lint/suspicious/noEmptyInterface: apps add their kit to it by declaration merging
export interface Register {}
export type RegisteredKit = Register extends { kit: infer K extends AnyKit }
	? K
	: AnyKit;

export type MetaOf<K extends AnyKit> = K["~spec"] extends {
	meta: Meta<infer M>;
}
	? M
	: unknown;
export type EntityOf<K extends AnyKit> = K["~spec"]["entities"][number];
export type RootOf<K extends AnyKit> = K["~spec"]["root"];

export type ImplNames<E> =
	Def<E> extends { impls: infer Im extends readonly unknown[] }
		? Im[number] extends infer I
			? I extends Impl<infer T>
				? T["name"]
				: never
			: never
		: never;
export type Implementers<T extends AnyTrait, K extends AnyKit> =
	EntityOf<K> extends infer E
		? E extends AnyEntity
			? T["name"] extends ImplNames<E>
				? E
				: never
			: never
		: never;
export type AllOf<
	Ts extends readonly AnyTrait[],
	K extends AnyKit,
> = Ts extends readonly [
	infer H extends AnyTrait,
	...infer R extends readonly AnyTrait[],
]
	? Extract<Implementers<H, K>, AllOf<R, K>>
	: EntityOf<K>;

/** The entities a member type may hold. */
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
