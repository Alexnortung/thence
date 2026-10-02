// The functions that define a kit: `trait`, `impl`, `entity` and `fn`. Each
// only records what it was given as plain data; their types, and what they
// infer, are in entity.ts and fn.ts.

import type { EntityFactory, ImplFactory, Trait, TraitFactory } from "./entity";
import type { Expr } from "./expr";
import type { Aggregate, Fn, FnFactory, FnSpec } from "./fn";

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
	(name: string, spec: FnSpec): Fn<any, any, any, any> => ({
		"~kind": "fn",
		name,
		"~params": spec.params,
		"~ret": undefined,
		"~inv": undefined,
		spec,
	}),
	{
		aggregate: <A, V, R>(spec: {
			init: A;
			add(acc: A, v: V): A;
			remove(acc: A, v: V): A;
			result(acc: A): R;
		}): Aggregate<A, V, R> => ({
			"~kind": "aggregate",
			init: () => spec.init,
			add: spec.add,
			remove: spec.remove,
			result: spec.result,
		}),
	},
) as FnFactory;
