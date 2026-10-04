import type { Json, Path, Result } from "../values";

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
	/** The node's meta, as the Builder wrote it; none for an element an Operator adds. */
	readonly meta?: Json;
	readonly inputs: Readonly<Record<string, InputPlan>>;
	/** Derived members and config members, all computed from expressions or constants. */
	readonly values: Readonly<Record<string, ValuePlan>>;
	/**
	 * Members that hold entities the program placed: the Builder's config
	 * members, and inputs that hold one fixed entity. Unlike an input
	 * collection's elements, they exist from the start and never change.
	 */
	readonly placed: Readonly<Record<string, PlacedPlan>>;
	/**
	 * The traits the entity implements, by name, with each member as the
	 * impl gives it. A value member sits at `[...instance, "as:priced",
	 * "total"]`, apart from the entity's own members.
	 */
	readonly traits: Readonly<Record<string, TraitPlan>>;
}

/** How an instance implements one trait. */
export interface TraitPlan {
	/** The members that hold values, computed in the instance's own scope. */
	readonly values: Readonly<Record<string, ValuePlan>>;
	/**
	 * The members that hold an entity or a collection: the instance's own
	 * member they stand for, as in `{ customer: e.self("customer") }`. A path
	 * through one goes straight to that member, so it never shows in an
	 * address.
	 */
	readonly aliases: Readonly<Record<string, Address>>;
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
	/**
	 * A Builder's enum, whose values can change after ops were saved: a value
	 * outside `values` is kept, and reported as an issue.
	 */
	readonly open?: boolean;
	/** Each value's meta, as the Builder wrote it. */
	readonly meta?: Readonly<Record<string, Json>>;
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
			readonly check?: Check;
	  }
	| {
			readonly kind: "list" | "map";
			/** The shape every element has. */
			readonly of: string;
	  }
	| {
			/**
			 * An entity the Operator may switch for another that implements the
			 * same trait, such as `customer: TPerson.initial(EPersonField)`. It
			 * holds one instance at a time, addressed by its entity's name:
			 * `["customer", "personField", "first"]`.
			 */
			readonly kind: "choice";
			/** The shape of each entity it may hold, by entity name. */
			readonly options: Readonly<Record<string, string>>;
			/** The entity it starts as. */
			readonly initial: string;
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
	/**
	 * Which reference a write to the value goes to, given which references
	 * accept writes now; `undefined` when the value doesn't accept writes. See
	 * {@link Inverse}.
	 */
	readonly inverse?: (
		writable: (ref: number) => boolean,
	) => Inverse | undefined;
	/** Set when the value is in a cycle: it is computed with the others by iteration. */
	readonly cycle?: CyclePlan;
	readonly check?: Check;
}

/**
 * The checks on a member's type, as one call: the issues they find with a
 * value, each with its path inside the value. None means every check passes.
 */
export type Check = (value: unknown) => readonly CheckIssue[];

/** What a check found with a value, and where inside it: `[]` for the value itself. */
export interface CheckIssue {
	readonly message: string;
	readonly path: Path;
}

/**
 * A value in a cycle the checker found. Every value in the cycle is
 * computed together: each starts from its seed, and each round computes
 * them all in `members` order from the values so far, until a round changes
 * nothing. After 100 rounds they are all `cycle.nonconvergent`.
 */
export interface CyclePlan {
	/**
	 * Every value in the cycle, this one included, in the order a round
	 * computes them: from this value's instance, `up` segments out and then
	 * down `path`, as a {@link Ref} reads.
	 */
	readonly members: readonly { readonly up: number; readonly path: Address }[];
	/** Where it starts each time the cycle is computed: its `seeds` entry, or its type's zero. */
	readonly seed: unknown;
	/** When two rounds count as the same for this value; bitwise equality without it. */
	readonly converge?: { readonly abs?: number; readonly rel?: number };
}

/**
 * How a write to a value goes back through its expression: every call on the
 * way down has exactly one argument that accepts writes, and an inverse for
 * that parameter. The reference at the bottom is an input, or a value that
 * accepts writes itself, so the engine follows it until it reaches an input.
 */
export interface Inverse {
	/** The reference the write goes to. */
	readonly ref: number;
	/**
	 * The value that reference needs for the expression to give `target`,
	 * with the other references at their values now (`args`, in the order of
	 * `refs`). An error when no value gives it, such as a discount on a
	 * subtotal of 0.
	 */
	value(target: unknown, args: readonly unknown[]): Result<unknown>;
}

/**
 * Something a value reads, relative to the instance that holds the value, or
 * to the instance `up` segments of its address further out: a Builder's
 * formula can read its siblings, its parent (`$parent`) and the root
 * (`$root`), and its instance's address is fixed, so the checker knows how
 * far out each is.
 *
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
			readonly up?: number;
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
			readonly up?: number;
	  }
	| {
			/** One value from every element of a collection, folded into one. */
			readonly kind: "fold";
			/** Where the collection is, from this instance. */
			readonly list: Address;
			/** The value each element contributes, from the element. */
			readonly each: readonly Step[];
			readonly aggregate: Fold;
			readonly up?: number;
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
			/** For a trait's member: the trait. */
			readonly trait?: string;
	  };
