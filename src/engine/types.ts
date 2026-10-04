import type { Change } from "../log";
import type { Address } from "../plan";
import type { Json, Result } from "../values";

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
	/** Recomputes the watched values that may have changed, and returns those that did. */
	settle(): readonly Address[];
	/**
	 * The input a write to `at` lands on, and the value it gets as JSON. A
	 * write to a derived value goes back through the inverses of its
	 * expression, and through the values it reads, until it reaches an input.
	 * `write.readonly` when nothing at `at` accepts writes, and
	 * `write.noAnswer` when an inverse has no answer.
	 */
	resolveWrite(at: Address, value: unknown): Result<{ at: Address; v: Json }>;
	/** Whether `resolveWrite` can reach an input from `at` now. */
	writable(at: Address): boolean;
}
