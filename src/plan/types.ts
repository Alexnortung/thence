import type { Json, Result } from "../values";

/**
 * Where an instance or a member lives in a running program: member names and
 * list element ids, from the root. `["rows", "c1:3", "amount"]` is the amount
 * of the row whose id is `c1:3`. Positions never appear in an address.
 */
export type Address = readonly string[];

/** A compiled program. */
export interface Plan {
	/** The shape of the root instance. */
	readonly root: string;
	/** Every shape, by id. */
	readonly shapes: ReadonlyMap<string, Shape>;
}

/** What one kind of instance holds: its inputs and the values it computes. */
export interface Shape {
	readonly id: string;
	/** The entity's name, as `handle.type` reports it. */
	readonly entity: string;
	readonly inputs: Readonly<Record<string, InputPlan>>;
	/** Derived members and config members, all computed from expressions or constants. */
	readonly values: Readonly<Record<string, ValuePlan>>;
}

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

/** An input: a value the Operator sets, or a list the Operator adds rows to. */
export type InputPlan =
	| {
			readonly kind: "value";
			readonly type: ValueTypePlan;
			/** The value before any op sets it, as JSON. */
			readonly initial: Json;
	  }
	| {
			readonly kind: "list";
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
 * Every reference is known before anything runs, so dependencies are static.
 */
export type Ref =
	| {
			/** A member of this instance: an input or another computed value. */
			readonly kind: "member";
			readonly name: string;
	  }
	| {
			/** One member of every element of a list, folded into one value. */
			readonly kind: "fold";
			/** The list input on this instance. */
			readonly list: string;
			/** The member each element contributes. */
			readonly member: string;
			readonly aggregate: Fold;
	  };

/**
 * How the engine folds a collection: an accumulator per fold, changed one
 * element at a time. Values are never `null`-checked here; the aggregate
 * decides what `null` means.
 */
export interface Fold<A = unknown> {
	init(): A;
	add(acc: A, v: unknown): A;
	remove(acc: A, v: unknown): A;
	result(acc: A): unknown;
}

/** What an address names: an instance, or one of its members. */
export type Located =
	| { readonly kind: "instance"; readonly shape: Shape }
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
