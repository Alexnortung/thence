import type { Address, Fold, Step } from "../plan";
import { FnError, fail, ok, type Result, type ThenceError } from "../values";
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
	/** The cells it read, the other way round from `dependents`: what it needs kept. */
	readonly reads = new Set<Cell>();
	/**
	 * Set once the engine dropped it. Whoever still holds it gets a new cell
	 * from the engine instead: this one no longer hears of changes.
	 */
	evicted = false;
	/** The cells it reads that may have changed since it was last clean. */
	readonly #suspects = new Set<Cell>();
	/** Set while it checks or computes; reading it then is a cycle. */
	#busy = false;

	constructor(readonly at: Address) {}

	/** Computes the value from scratch, reading other cells with {@link Cell.read}. */
	protected abstract compute(): Result<unknown>;

	/** Called when a cell this one reads changed its value, before this one becomes dirty. */
	protected onDirtyDependency(_dependency: Cell): void {}

	/** Forgets what a compute kept besides the value, such as a fold's accumulator. */
	protected onEvict(): void {}

	/**
	 * Drops the value and every link to other cells, so the cells it read no
	 * longer tell it about changes. The engine evicts only cells that no
	 * watched cell reads, directly or further down.
	 */
	evict(): void {
		for (const dependency of this.reads) dependency.dependents.delete(this);
		this.reads.clear();
		this.dependents.clear();
		this.#suspects.clear();
		this.value = undefined;
		this.state = "dirty";
		this.evicted = true;
		this.onEvict();
	}

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
		this.reads.add(dependency);
		return dependency.get();
	}

	/** Stops reading a cell, such as an element that left the collection. */
	protected unread(dependency: Cell): void {
		dependency.dependents.delete(this);
		this.reads.delete(dependency);
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
 * What an element's cell gives a fold when a `filter` leaves the element
 * out: the fold skips it, as if the element weren't there.
 */
export const SKIP: unique symbol = Symbol("skip");

/**
 * A fold over one value of every element of a collection. It keeps each
 * element's last value, so a change to one element removes the old value
 * from the accumulator and adds the new one; a change to the collection adds
 * and removes whole elements. An aggregate without `remove` starts over from
 * `init` instead.
 */
export class FoldCell extends Cell {
	readonly #members: Cell;
	readonly #element: (id: string) => Cell;
	readonly #aggregate: Fold;
	readonly #values = new Map<string, Result<unknown>>();
	/** Each element's cell, by id, and back: a cell may sit at another address than `[...list, id]`. */
	readonly #cells = new Map<string, Cell>();
	readonly #ids = new Map<Cell, string>();
	/** The elements whose value changed since the last compute. */
	readonly #changed = new Set<string>();
	/** The ids the last compute folded, in order. */
	#seen: readonly string[] = [];
	#acc: unknown;
	#started = false;
	#errors = 0;

	/**
	 * @param list - where the collection is
	 * @param each - the path from each element to the value it contributes, for its address
	 * @param members - the collection's cell, which holds its element ids
	 * @param element - the cell of that value in the element with a given id
	 */
	constructor(
		list: Address,
		each: readonly Step[],
		members: Cell,
		element: (id: string) => Cell,
		aggregate: Fold,
	) {
		super([...list, "$each", ...each.map(label)]);
		this.#members = members;
		this.#element = element;
		this.#aggregate = aggregate;
	}

	protected compute(): Result<unknown> {
		const fold = this.#aggregate;
		if (!this.#started) {
			this.#acc = fold.init();
			this.#started = true;
		}
		const ids = this.read(this.#members);
		// A collection that fails, such as a filter whose test failed, fails what folds it.
		if (!ids.ok) return caused(ids.error, this.at);
		const now = ids.value as readonly string[];
		if (now !== this.#seen) this.#follow(this.#seen, now);
		this.#seen = now;
		for (const id of this.#changed) {
			const old = this.#values.get(id);
			if (!old) continue;
			this.#take(old, -1);
			const r = this.read(this.#cellOf(id));
			this.#values.set(id, r);
			this.#take(r, 1);
		}
		this.#changed.clear();
		if (!fold.remove) {
			// Not incremental: fold every value again, in the collection's order.
			this.#acc = fold.init();
			for (const id of now) {
				const r = this.#values.get(id);
				if (r?.ok && r.value !== SKIP) this.#acc = fold.add(this.#acc, r.value);
			}
		}
		if (this.#errors > 0 && !fold.skipErrors) {
			const first = [...this.#values.values()].find((r) => !r.ok);
			if (first && !first.ok) return caused(first.error, this.at);
		}
		try {
			return ok(fold.result(this.#acc));
		} catch (e) {
			// An aggregate fails the way an `impl` does, such as `merge` with a key twice.
			if (e instanceof FnError) return fail(e.code, e.message, this.at);
			throw e;
		}
	}

	/**
	 * Takes out the elements that left and adds the ones that came. Only the
	 * stretch between the ids that stayed put at either end is compared, so an
	 * add or a remove costs a walk over the ids, not a set of them.
	 */
	#follow(was: readonly string[], now: readonly string[]): void {
		const shorter = Math.min(was.length, now.length);
		let start = 0;
		while (start < shorter && was[start] === now[start]) start++;
		let end = 0;
		while (
			end < shorter - start &&
			was[was.length - 1 - end] === now[now.length - 1 - end]
		)
			end++;
		const came = now.slice(start, now.length - end);
		const stayed = new Set(came);
		for (const id of was.slice(start, was.length - end)) {
			if (stayed.has(id)) continue;
			const r = this.#values.get(id);
			if (r) this.#take(r, -1);
			this.#values.delete(id);
			this.#changed.delete(id);
			const cell = this.#cells.get(id);
			if (cell) {
				this.unread(cell);
				this.#ids.delete(cell);
				this.#cells.delete(id);
			}
		}
		for (const id of came) {
			if (this.#values.has(id)) continue;
			const r = this.read(this.#cellOf(id));
			this.#values.set(id, r);
			this.#take(r, 1);
		}
	}

	protected override onDirtyDependency(dependency: Cell): void {
		const id = this.#ids.get(dependency);
		if (id !== undefined) this.#changed.add(id);
	}

	protected override onEvict(): void {
		this.#values.clear();
		this.#cells.clear();
		this.#ids.clear();
		this.#changed.clear();
		this.#seen = [];
		this.#acc = undefined;
		this.#started = false;
		this.#errors = 0;
	}

	#cellOf(id: string): Cell {
		let cell = this.#cells.get(id);
		if (!cell) {
			cell = this.#element(id);
			this.#cells.set(id, cell);
			this.#ids.set(cell, id);
		}
		return cell;
	}

	#take(r: Result<unknown>, sign: 1 | -1): void {
		if (!r.ok) this.#errors += sign;
		else if (r.value === SKIP) return;
		else if (this.#aggregate.remove) {
			this.#acc =
				sign === 1
					? this.#aggregate.add(this.#acc, r.value)
					: this.#aggregate.remove(this.#acc, r.value);
		}
	}
}

/** What a lookup needs from the engine: cells by address, and which addresses are collections. */
export interface Cells {
	cellAt(at: Address): Cell;
	/** Whether the address names a list, a map or a trait-typed input, which holds one instance at a time. */
	collection(at: Address): "list" | "map" | "choice" | undefined;
}

/**
 * A value found through an Operator's collection or a position: `rows
 * {"at": 0} amount`, `rows "c1:4" amount` or `$prev balance`. It reads the
 * collections on the way, so it finds the value again when they change, and
 * is `null` when nothing is there.
 */
export class LookupCell extends Cell {
	readonly #owner: Address;
	readonly #steps: readonly Step[];
	readonly #cells: Cells;
	#target: Cell | undefined;

	constructor(owner: Address, steps: readonly Step[], cells: Cells) {
		super([...owner, ...steps.map(label)]);
		this.#owner = owner;
		this.#steps = steps;
		this.#cells = cells;
	}

	protected compute(): Result<unknown> {
		let at: readonly string[] = this.#owner;
		for (const step of this.#steps) {
			let id: string | undefined;
			if (typeof step === "object" && "neighbour" in step) {
				const list = at.slice(0, -1);
				if (at.length === 0 || this.#cells.collection(list) !== "list") {
					return this.#found(undefined);
				}
				const ids = this.#ids(list);
				const i = positions(ids).get(at[at.length - 1] as string);
				id = i === undefined ? undefined : ids[i + step.neighbour];
				at = list;
			} else if (this.#cells.collection(at)) {
				const ids = this.#ids(at);
				if (typeof step === "object") {
					id = ids[step.at < 0 ? ids.length + step.at : step.at];
				} else if (positions(ids).has(step)) id = step;
			} else id = step as string;
			if (id === undefined) return this.#found(undefined);
			at = [...at, id];
		}
		return this.#found(this.#cells.cellAt(at));
	}

	protected override onEvict(): void {
		this.#target = undefined;
	}

	/** The cell the path led to when last computed; `undefined` when it led nowhere. */
	get target(): Cell | undefined {
		return this.#target;
	}

	/** Reads the cell the path leads to, or `null` when it leads nowhere. */
	#found(target: Cell | undefined): Result<unknown> {
		if (this.#target && this.#target !== target) this.unread(this.#target);
		this.#target = target;
		return target ? this.read(target) : ok(null);
	}

	#ids(collection: Address): readonly string[] {
		const r = this.read(this.#cells.cellAt(collection));
		return r.ok ? (r.value as readonly string[]) : [];
	}
}

/** An instance's position in the list that holds it, or its key in the map: `$index` and `$key`. */
export class PlaceCell extends Cell {
	readonly #of: "index" | "key";
	readonly #cells: Cells;

	constructor(owner: Address, of: "index" | "key", cells: Cells) {
		super([...owner, `$${of}`]);
		this.#of = of;
		this.#cells = cells;
	}

	protected compute(): Result<unknown> {
		const owner = this.at.slice(0, -1);
		const list = owner.slice(0, -1);
		const id = owner[owner.length - 1];
		const kind = owner.length > 0 ? this.#cells.collection(list) : undefined;
		if (id === undefined || !kind || kind === "choice") return ok(null);
		if (this.#of === "key") return ok(kind === "map" ? id : null);
		const ids = this.read(this.#cells.cellAt(list));
		const i = ids.ok ? positions(ids.value as string[]).get(id) : undefined;
		return ok(i ?? null);
	}
}

const indexes = new WeakMap<readonly string[], Map<string, number>>();

/** Each id's position, worked out once per list of ids. */
function positions(ids: readonly string[]): Map<string, number> {
	let found = indexes.get(ids);
	if (!found) {
		found = new Map(ids.map((id, i) => [id, i]));
		indexes.set(ids, found);
	}
	return found;
}

/** A step as it shows in a cell's address, for debugging and `explain`. */
function label(step: Step): string {
	if (typeof step === "string") return step;
	return "at" in step
		? `{at:${step.at}}`
		: step.neighbour < 0
			? "$prev"
			: "$next";
}

/** A value fails because a value it reads failed: same code, and the cause attached. */
export function caused(error: ThenceError, at: Address): Result<never> {
	return {
		ok: false,
		error: { code: error.code, message: error.message, at, cause: error },
	};
}
