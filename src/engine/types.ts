import type { Change } from "../log";
import type { Address } from "../plan";
import type { Json, Result } from "../values";

/**
 * How a value was computed: its expression, and the values it read, each
 * explained the same way down to the inputs. A value met twice in one
 * explanation, as in a cycle, is explained only the first time.
 */
export interface Explanation {
	/** Where the value is. For a lookup, the value it found; for a fold, the collection, `$each`, and the path in each element. */
	readonly at: Address;
	readonly value: Result<unknown>;
	/** The expression as written, for a computed value. */
	readonly expr?: Json;
	/** For an input: the position in the log's `ops()` of the op that set it; absent for its initial value. */
	readonly op?: number;
	readonly source?: "input";
	readonly reads: readonly Explanation[];
}

/**
 * Computes the values of one session. The session is its only user: it reads
 * values for `member.get()`, watches the ones that have subscribers, and
 * after every op tells the engine what changed and asks which watched values
 * changed with it.
 *
 * The engine knows addresses, not subscribers: it counts how often each value
 * is watched, and the session keeps the listeners and decides when to call
 * them. In turn, the session never sees how values depend on each other, what
 * is cached, or what gets recomputed. (`program.dependencies` answers from the
 * plan, not from here.)
 */
export interface Engine {
	/** The value at an address now, computing what it needs. */
	read(at: Address): Result<unknown>;
	/** Keeps a value up to date: `settle` recomputes it and reports when it changes. */
	watch(at: Address): void;
	/** Undoes one `watch`. A value no one watches is still cached, and recomputed when next read. */
	unwatch(at: Address): void;
	/**
	 * Tells the engine which inputs and lists the log changed. The log doesn't
	 * know the engine, so the session passes along what `log.apply` returns,
	 * whether the op was the Operator's own write, another Operator's or a
	 * saved one. Computes nothing: the inputs become dirty and what reads them
	 * pending.
	 */
	invalidate(changes: readonly Change[]): void;
	/** How the value at an address was computed, down to the inputs. */
	explain(at: Address): Explanation;
	/** Recomputes the watched values that may have changed, and returns those that did. */
	settle(): readonly Address[];
	/**
	 * The input a write to `at` lands on, and the value it gets. Only inputs
	 * so far; writes through inverses come later.
	 */
	resolveWrite(
		at: Address,
		value: unknown,
	): Result<{ at: Address; v: unknown }>;
}
