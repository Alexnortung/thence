import type { Address } from "../plan";
import type { Json, Result } from "../values";

// A write passes through three types, one per step:
//
//   Intent --log.local()--> Op --log.apply()--> Change[] --engine.invalidate()
//
// An Intent is what this process wants, an Op is the record every process
// agrees on, and a Change is what applying the op did, in terms the engine
// understands.

/**
 * What this process wants to do, in its own terms: "set this member to this
 * value", "add a row at position 2". Only the local session makes intents,
 * from the handle methods (`set`, `add`, `insert`, `move`, `remove`).
 *
 * An intent can't be sent to another process as it is. A position means
 * different rows on two screens, and a new row needs an id both agree on. So
 * {@link Log.local} turns it into an {@link Op}.
 */
export type Intent =
	| { t: "set"; at: Address; v: unknown }
	| { t: "clear"; at: Address }
	/** Adds an element at `index`, or at the end. */
	| { t: "add"; at: Address; index?: number }
	/** Moves the element at `at` to `index` among its siblings. */
	| { t: "move"; at: Address; index: number }
	| { t: "remove"; at: Address };

/**
 * One change an Operator made, as every process records it. Ops are what the
 * app saves, what `onApply` hands it to send to other Operators, and what
 * `program.run(ops)` replays. Every process that applies the same ops ends in
 * the same state, whatever order they arrive in.
 *
 * Compared with an {@link Intent}, an op is self-contained: the value is JSON,
 * a new element has its id, a position has become an order key between its
 * neighbours, and `clock` (`replica:counter`) says which of two ops on the
 * same input came later. `at` holds member names and element ids, never
 * positions. An `add` without an `id` uses its clock as the id.
 */
export type Op =
	| { t: "set"; at: Address; v: Json; clock?: string }
	| { t: "clear"; at: Address; clock?: string }
	| {
			t: "add";
			at: Address;
			id?: string;
			key?: string;
			order: string;
			clock?: string;
	  }
	| { t: "move"; at: Address; order: string; clock?: string }
	| { t: "remove"; at: Address; clock?: string };

/**
 * What applying an op changed in the log: one input's value, or which
 * elements a list holds and in what order. It is all the engine learns from
 * the log: it marks what reads `at` dirty and never sees ops. An op that
 * loses to a later one gives no change, and a `remove` gives a `members`
 * change on its list.
 */
export type Change =
	| { readonly kind: "input"; readonly at: Address }
	| { readonly kind: "members"; readonly at: Address };

/**
 * The Operators' ops for one session, and the input values and list elements
 * they add up to. The session is its only user: it turns handle calls into
 * intents, applies ops, and passes the changes on to the engine. The engine
 * reads input values and list elements from it.
 */
export interface Log {
	/** This process's replica id, the first part of its clocks and element ids. */
	readonly replica: string;
	/**
	 * Applies an op from anywhere: this session, a saved log, or another
	 * Operator. An op that loses to a later one changes nothing. An op that
	 * doesn't fit the plan is rejected and not recorded.
	 *
	 * Removal wins: an op inside an element that was removed, even by an op
	 * with an earlier clock, applies nothing. So if one Operator edits a row
	 * while another removes it, the edit is lost. y.js behaves the same way:
	 * whatever is written into a type another client deleted is deleted with
	 * it, so using it wouldn't keep the edit. Two ways we could keep it later:
	 * record those ops instead of dropping them, so that undoing the removal
	 * brings the row back with the edit; or let a concurrent edit win and
	 * restore the row.
	 */
	apply(op: Op): Result<readonly Change[]>;
	/**
	 * Makes the op for an intent of this process, without applying it: a fresh
	 * clock, the new element's id, and the order key for the position.
	 */
	local(intent: Intent): Result<Op>;
	/** An input's value now: what the last op set, or its initial value. */
	input(at: Address): unknown;
	/** Whether an op has set the input. */
	isSet(at: Address): boolean;
	/** A list's element ids, in order. */
	members(at: Address): readonly string[];
	/** Every op applied so far, in the order it was applied. */
	ops(): readonly Op[];
}
