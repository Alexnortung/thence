// The functions that define a kit: `trait`, `impl`, `entity` and `fn`. Each
// only records what it was given as plain data; their types, and what they
// infer, are in entity.ts and fn.ts.

import type { EntityFactory, ImplFactory, Trait, TraitFactory } from "./entity";
import type { Expr } from "./expr";
import type { Aggregate, Fn, FnFactory, FnSpec, ParamType } from "./fn";

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
	(name: string, ...signatures: FnSpec[]): Fn<any, any, any, any> => {
		for (const signature of signatures) paramList(name, signature);
		return {
			"~kind": "fn",
			name,
			"~params": Object.fromEntries(
				signatures[0] ? paramList(name, signatures[0]) : [],
			),
			"~ret": undefined,
			"~inv": undefined,
			signatures,
		};
	},
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

/**
 * A signature's parameters as `[name, type]` pairs, in order. Throws if an
 * entry doesn't name exactly one parameter, or a name comes twice.
 *
 * @param fnName - the function's name, for the error
 */
export function paramList(
	fnName: string,
	signature: FnSpec,
): [string, ParamType][] {
	const list = signature.params.map((entry): [string, ParamType] => {
		const pairs = Object.entries(entry);
		const pair = pairs[0];
		if (pairs.length !== 1 || !pair) {
			throw new Error(
				`thence: each of "${fnName}"'s params names exactly one parameter, as { x: t.number }`,
			);
		}
		return pair;
	});
	const names = list.map(([n]) => n);
	const twice = names.find((n, i) => names.indexOf(n) !== i);
	if (twice !== undefined) {
		throw new Error(`thence: "${fnName}" has two parameters named "${twice}"`);
	}
	return list;
}
