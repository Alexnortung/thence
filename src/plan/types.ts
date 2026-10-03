import type { Json, Result } from "../values";

/**
 * Where an instance or a member lives in a running program: member names,
 * map keys and list element ids, from the root. `["rows", "c1:3", "amount"]`
 * is the amount of the row whose id is `c1:3`. Positions never appear in an
 * address.
 */
export type Address = readonly string[];

/** A compiled program. */
export interface Plan {
	/** The shape of the root instance. */
	readonly root: string;
	/** Every shape, by id. */
	readonly shapes: ReadonlyMap<string, Shape>;
}

/**
 * What one kind of instance holds: its inputs, the values it computes, and
 * the entities the program placed in it.
 */
export interface Shape {
	readonly id: string;
	/** The entity's name, as `handle.type` reports it. */
	readonly entity: string;
	readonly inputs: Readonly<Record<string, InputPlan>>;
	/** Derived members and config members, all computed from expressions or constants. */
	readonly values: Readonly<Record<string, ValuePlan>>;
	/**
	 * Members that hold entities the program placed: the Builder's config
	 * members, and inputs that hold one fixed entity. Unlike an input
	 * collection's elements, they exist from the start and never change.
	 */
	readonly placed: Readonly<Record<string, PlacedPlan>>;
}

/**
 * What a placed member holds: one entity, or a map or list of them. Each
 * element has its own shape, since the Builder configures each one.
 */
export type PlacedPlan =
	| { readonly kind: "entity"; readonly shape: string }
	| {
			readonly kind: "map" | "list";
			/** In order. A map's ids are its keys; a list's are the positions the Builder placed them at. */
			readonly elements: readonly {
				readonly id: string;
				readonly shape: string;
			}[];
	  };

/** A value type, as the log checks an op against it. */
export interface ValueTypePlan {
	readonly base:
		| "number"
		| "int"
		| "decimal"
		| "text"
		| "bool"
		| "date"
		| "json"
		| "enum";
	readonly nullable: boolean;
	readonly scale?: number;
	readonly values?: readonly string[];
}

/**
 * An input: a value the Operator sets, or a collection the Operator adds
 * elements to: a list, whose elements get ids, or a map, keyed by the
 * Operator's text.
 */
export type InputPlan =
	| {
			readonly kind: "value";
			readonly type: ValueTypePlan;
			/** The value before any op sets it, as JSON. */
			readonly initial: Json;
	  }
	| {
			readonly kind: "list" | "map";
			/** The shape every element has. */
			readonly of: string;
	  };

/**
 * A computed value. The engine reads each of `refs`, and if none failed,
 * calls `compute` with their values in the same order.
 */
export interface ValuePlan {
	/** The expression as written, for `explain` and diagnostics. */
	readonly expr: Json;
	readonly refs: readonly Ref[];
	readonly compute: (args: readonly unknown[]) => Result<unknown>;
}

/**
 * Something a value reads, relative to the instance that holds the value.
 * Every reference is known before anything runs, so dependencies are static;
 * only which element a position or an Operator's key names is found at run
 * time.
 */
export type Ref =
	| {
			/**
			 * A member of this instance, or of an entity the program placed in it:
			 * an address that exists for the life of the session.
			 */
			readonly kind: "member";
			readonly path: Address;
	  }
	| {
			/**
			 * A value found through an Operator's collection or a position, such
			 * as `rows {"at": 0} amount` or `$prev balance`. It is found again
			 * whenever the collection changes, and is `null` when nothing is
			 * there, such as a removed row.
			 */
			readonly kind: "lookup";
			readonly path: readonly Step[];
	  }
	| {
			/** One value from every element of a collection, folded into one. */
			readonly kind: "fold";
			/** Where the collection is, from this instance. */
			readonly list: Address;
			/** The value each element contributes, from the element. */
			readonly each: readonly Step[];
			readonly aggregate: Fold;
	  }
	| {
			/** This instance's position in the list that holds it, or its key in the map. */
			readonly kind: "place";
			readonly of: "index" | "key";
	  };

/**
 * One step of a {@link Ref}'s path: a member name, a map key or an element
 * id, as in an address; the element at a position in a list now (`-1` is
 * the last); or, as the first step, the element before or after this
 * instance in the list that holds it.
 */
export type Step =
	| string
	| { readonly at: number }
	| { readonly neighbour: -1 | 1 };

/**
 * How the engine folds a collection: an accumulator per fold, changed one
 * element at a time. Values are never `null`-checked here; the aggregate
 * decides what `null` means.
 */
export interface Fold<A = unknown> {
	init(): A;
	add(acc: A, v: unknown): A;
	/** Takes one value out again. Without it, the fold starts over from `init` on every change. */
	remove?(acc: A, v: unknown): A;
	result(acc: A): unknown;
	/** Leaves out the elements whose value is an error, instead of failing. */
	readonly skipErrors?: boolean;
}

/** What an address names: an instance, or one of its members. */
export type Located =
	| { readonly kind: "instance"; readonly shape: Shape }
	| {
			/** A map or list the program placed; its elements never change. */
			readonly kind: "placed";
			readonly owner: Shape;
			readonly name: string;
			readonly placed: Extract<PlacedPlan, { kind: "map" | "list" }>;
	  }
	| {
			readonly kind: "input";
			readonly owner: Shape;
			readonly name: string;
			readonly input: InputPlan;
	  }
	| {
			readonly kind: "value";
			readonly owner: Shape;
			readonly name: string;
			readonly value: ValuePlan;
	  };
