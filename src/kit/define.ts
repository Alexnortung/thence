// The functions that define a kit: `trait`, `impl`, `entity` and `fn`. Each
// only records what it was given as plain data; their types, and what they
// infer, are in entity.ts and fn.ts.

import type { EntityFactory, ImplFactory, Trait, TraitFactory } from "./entity";
import type { Expr } from "./expr";
import type { Aggregate, AggregateSpec, Fn, FnFactory, FnSpec } from "./fn";

/** Defines a trait; see {@link TraitFactory}. */
export const trait: TraitFactory = (name, members, defaults) => {
	const self: Trait<any, any, any> = {
		"~kind": "trait",
		name,
		"~members": members,
		"~defaults": undefined,
		defaults: (defaults ?? {}) as Record<string, Expr>,
		initial: (entity) => ({
			"~kind": "traitInitial",
			"~trait": self,
			"~entity": entity,
		}),
	};
	return self;
};

/** Defines how an entity implements a trait; see {@link ImplFactory}. */
export const impl: ImplFactory = (trait, body) => ({
	"~kind": "impl",
	"~trait": trait,
	body,
});

/** Defines an entity; see {@link EntityFactory}. */
export const entity: EntityFactory = (name, def) => ({
	"~kind": "entity",
	name,
	"~def": def as any,
});

/** Defines a function; see {@link FnFactory}. */
export const fn: FnFactory = Object.assign(
	(name: string, ...signatures: FnSpec[]): Fn<any, any, any, any> => ({
		"~kind": "fn",
		name,
		"~params": signatures[0]?.params,
		"~ret": undefined,
		"~inv": undefined,
		signatures,
	}),
	{
		aggregate: <A, V, R>(spec: AggregateSpec<A, V, R>): Aggregate<A, V, R> => ({
			"~kind": "aggregate",
			// A fresh copy for each collection, since `add` may change the one it gets.
			init: () =>
				typeof spec.init === "object" && spec.init !== null
					? (JSON.parse(JSON.stringify(spec.init)) as A)
					: spec.init,
			add: spec.add,
			...("remove" in spec ? { remove: spec.remove } : {}),
			result: spec.result,
			...(spec.skipErrors ? { skipErrors: true } : {}),
		}),
	},
) as FnFactory;
