import type { Address, Fold } from "../plan";
import { fail, ok, type Result, type ThenceError } from "../values";
import { same } from "./same";

/**
 * Whether a cell's value can be used as it is.
 *
 * - `clean`: it is current.
 * - `dirty`: a value it reads changed, so it recomputes when read.
 * - `pending`: something further up changed. When read, it first brings its
 *   suspects up to date, and recomputes only if one of their values changed.
 *
 * A change makes only the input dirty, and everything that depends on it
 * pending. A cell whose value changes makes its direct dependents dirty. So a
 * change that doesn't change a value in between, such as a `max` that stays
 * the same, recomputes nothing after it.
 */
type State = "clean" | "pending" | "dirty";

/** One cached value: an input, a computed value, or a fold over a list. */
export abstract class Cell {
	value: Result<unknown> | undefined = undefined;
	state: State = "dirty";
	/** How many subscriptions keep it up to date. */
	watchers = 0;
	/**
	 * The cells that read this one, which become pending when it may change
	 * and dirty when it does.
	 *
	 * Dependencies are static: a value depends on every reference in its
	 * expression, even the branch of an `if` it didn't take. Later the engine
	 * could keep only the references the last compute read (the active ones),
	 * so that a change on the branch not taken doesn't make it pending.
	 */
	readonly dependents = new Set<Cell>();
	/** The cells it reads that may have changed since it was last clean. */
	readonly #suspects = new Set<Cell>();
	/** Set while it checks or computes; reading it then is a cycle. */
	#busy = false;

	constructor(readonly at: Address) {}

	/** Computes the value from scratch, reading other cells with {@link Cell.read}. */
	protected abstract compute(): Result<unknown>;

	/** Called when a cell this one reads changed its value, before this one becomes dirty. */
	protected onDirtyDependency(_dependency: Cell): void {}

	/** The value now, recomputing it only if a value it reads changed. */
	get(): Result<unknown> {
		if (this.#busy) {
			return fail("cycle", "this value depends on itself", this.at);
		}
		if (this.state === "clean" && this.value) return this.value;
		this.#busy = true;
		try {
			// A suspect whose value changes makes this cell dirty.
			for (const suspect of this.#suspects) {
				if (suspect.state !== "clean") suspect.get();
			}
			this.#suspects.clear();
			if (this.state === "dirty" || !this.value) {
				const before = this.value;
				this.value = this.compute();
				if (before && !same(before, this.value)) {
					for (const d of this.dependents) {
						d.onDirtyDependency(this);
						d.state = "dirty";
					}
				}
			}
			this.state = "clean";
		} finally {
			this.#busy = false;
		}
		return this.value;
	}

	/** Marks the cell dirty, because the input it reads changed, and everything after it pending. */
	invalidate(): void {
		this.state = "dirty";
		this.#suspect();
	}

	/** Reads another cell's value, and records that this one depends on it. */
	protected read(dependency: Cell): Result<unknown> {
		dependency.dependents.add(this);
		return dependency.get();
	}

	/** Makes everything that depends on this cell pending, with the path back as suspects. */
	#suspect(): void {
		for (const d of this.dependents) {
			d.#suspects.add(this);
			if (d.state === "clean") {
				d.state = "pending";
				d.#suspect();
			}
		}
	}
}

/**
 * An input or a computed value. `compute` gets a function to read the cells
 * it depends on.
 */
export class ComputedCell extends Cell {
	readonly #compute: (
		read: (dependency: Cell) => Result<unknown>,
	) => Result<unknown>;

	constructor(
		at: Address,
		compute: (read: (dependency: Cell) => Result<unknown>) => Result<unknown>,
	) {
		super(at);
		this.#compute = compute;
	}

	protected compute(): Result<unknown> {
		return this.#compute((dependency) => this.read(dependency));
	}
}

/**
 * A fold over one member of every element of a list. It keeps each element's
 * last value, so a change to one element removes the old value from the
 * accumulator and adds the new one; a change to the list adds and removes
 * whole elements.
 */
export class FoldCell extends Cell {
	readonly #members: Cell;
	readonly #member: (id: string) => Cell;
	readonly #aggregate: Fold;
	readonly #values = new Map<string, Result<unknown>>();
	/** The elements whose value changed since the last compute. */
	readonly #changed = new Set<string>();
	#acc: unknown;
	#started = false;
	#errors = 0;

	/**
	 * @param list - where the list is
	 * @param memberName - the member each element contributes
	 * @param members - the list's cell, which holds its element ids
	 * @param member - that member's cell in the element with a given id
	 */
	constructor(
		list: Address,
		memberName: string,
		members: Cell,
		member: (id: string) => Cell,
		aggregate: Fold,
	) {
		super([...list, "$each", memberName]);
		this.#members = members;
		this.#member = member;
		this.#aggregate = aggregate;
	}

	protected compute(): Result<unknown> {
		if (!this.#started) {
			this.#acc = this.#aggregate.init();
			this.#started = true;
		}
		const ids = this.read(this.#members);
		const now = new Set(ids.ok ? (ids.value as string[]) : []);
		for (const [id, r] of this.#values) {
			if (!now.has(id)) {
				this.#take(r, -1);
				this.#values.delete(id);
				this.#member(id).dependents.delete(this);
			}
		}
		for (const id of now) {
			const old = this.#values.get(id);
			if (old && !this.#changed.has(id)) continue;
			if (old) this.#take(old, -1);
			const r = this.read(this.#member(id));
			this.#values.set(id, r);
			this.#take(r, 1);
		}
		this.#changed.clear();
		if (this.#errors > 0) {
			const first = [...this.#values.values()].find((r) => !r.ok);
			if (first && !first.ok) return caused(first.error, this.at);
		}
		return ok(this.#aggregate.result(this.#acc));
	}

	protected override onDirtyDependency(dependency: Cell): void {
		// An element's member is at [...list, id, member]: its id is where this cell has "$each".
		const id = dependency.at[this.at.length - 2];
		if (dependency !== this.#members && id !== undefined) this.#changed.add(id);
	}

	#take(r: Result<unknown>, sign: 1 | -1): void {
		if (r.ok) {
			this.#acc =
				sign === 1
					? this.#aggregate.add(this.#acc, r.value)
					: this.#aggregate.remove(this.#acc, r.value);
		} else this.#errors += sign;
	}
}

/** A value fails because a value it reads failed: same code, and the cause attached. */
export function caused(error: ThenceError, at: Address): Result<never> {
	return {
		ok: false,
		error: { code: error.code, message: error.message, at, cause: error },
	};
}
