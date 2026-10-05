import type { AnyKit, RootOf } from "../kit";
import type { Op } from "../log";
import type { Json, Path } from "../values";
import type { At, Handle, Member } from "./handles";

/**
 * A running program, made by `program.run(ops)`: the Operator's handles,
 * the ops applied so far, and what they changed.
 *
 * @typeParam K - the kit the program was built with
 */
export interface Session<K extends AnyKit> {
	/** A handle to the root entity. */
	readonly root: Handle<RootOf<K>, K>;
	/** The handle a path names, typed from the path; `undefined` when nothing is there. */
	at<const P extends readonly Segment[]>(path: P): At<K, P> | undefined;
	/** Every member's issues, from the checks on its type. */
	issues(): readonly Issue[];
	/** Applies ops, such as those another Operator made. */
	apply(op: Op | readonly Op[]): void;
	/** Runs `f` and notifies subscribers once, after it. */
	batch(f: () => void): void;
	/** Calls `f` with each op as it is applied, to send it elsewhere. Returns the unsubscribe. */
	onApply(f: (op: Op) => void): () => void;
	/** The ops applied so far, to save or replay. */
	ops(): readonly Op[];
	/** Every value, as JSON. */
	snapshot(): Json;
	/** How a member's value was computed, down to the inputs and the ops that set them. */
	explain(m: Member<unknown>): Explanation;
}
/**
 * How a value was computed, as `session.explain` gives it: its expression
 * and the values it read, each explained the same way, down to the inputs.
 * A value met twice, as in a cycle, is explained only the first time.
 */
export interface Explanation {
	/** Where the value is, by member names and row ids. A fold's path has `"$each"` where it visits every element. */
	readonly path: Path;
	/** The value as JSON, as in a snapshot: a decimal is a string. */
	readonly value?: Json;
	/** Instead of `value`, when computing it failed. */
	readonly error?: { readonly code: string; readonly message: string };
	/** The expression as written, for a computed value. */
	readonly expr?: Json;
	/** An input: what the Operator enters. */
	readonly source?: "input";
	/** For an input an op set: the op's position in `session.ops()`. */
	readonly op?: number;
	readonly reads: readonly Explanation[];
}

/** A name, a position, or a row by the id the program gave it. */
export type Segment = string | number | { readonly id: string };
/** A problem a check found with a value, and where. */
export type Issue = { message: string; path: Path };
