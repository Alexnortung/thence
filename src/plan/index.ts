/**
 * plan: the contract between the checker and the runtime. The checker builds
 * it; the log and the engine read it and never see a kit or a Builder's tree.
 *
 * One shape per entity definition, plus one per placement that carries
 * Builder formulas. A shape lists the instance's inputs and its computed
 * values. Each value keeps its original expression, the references it makes,
 * and a compiled closure that turns the referenced values into its own.
 * Instances such as rows are not in the plan: they live in the log as ops.
 *
 * It lives in memory only: closures can't be serialized, and rebuilding it is
 * fast.
 *
 * @module
 */

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

/**
 * Follows an address through the plan's shapes. It doesn't know which
 * elements exist; that is the log's business.
 */
export function locate(plan: Plan, at: Address): Located | undefined {
	let shape = plan.shapes.get(plan.root);
	let i = 0;
	while (shape) {
		if (i === at.length) return { kind: "instance", shape };
		const name = at[i] as string;
		const input = shape.inputs[name];
		const value = shape.values[name];
		if (i === at.length - 1) {
			if (input) return { kind: "input", owner: shape, name, input };
			if (value) return { kind: "value", owner: shape, name, value };
			return undefined;
		}
		if (input?.kind !== "list") return undefined;
		shape = plan.shapes.get(input.of);
		i += 2;
	}
	return undefined;
}
