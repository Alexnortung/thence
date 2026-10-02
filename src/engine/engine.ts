import type { Log } from "../log";
import { type Address, type Fold, locate, type Plan, type Ref } from "../plan";
import { fail, ok, type Result, type ThenceError } from "../values";
import { same } from "./same";
import type { Engine } from "./types";

/**
 * Whether a cell's value can be used as it is.
 *
 * - `clean`: it is current.
 * - `dirty`: a value it reads changed, so it recomputes when read.
 * - `pending`: something further up changed. When read, it first brings its
 *   `suspects` up to date, and recomputes only if one of their values changed.
 *
 * A change makes only the input dirty, and everything that depends on it
 * pending. A cell whose value changes makes its direct dependents dirty. So a
 * change that doesn't change a value in between, such as a `max` that stays
 * the same, recomputes nothing after it.
 */
type State = "clean" | "pending" | "dirty";

interface Cell {
	readonly at: Address;
	readonly compute: () => Result<unknown>;
	value: Result<unknown> | undefined;
	state: State;
	/** Set while it checks or computes; reading it then is a cycle. */
	busy: boolean;
	watchers: number;
	/**
	 * The cells that read this one, which become pending when it may change
	 * and dirty when it does.
	 *
	 * Dependencies are static: a value depends on every reference in its
	 * expression, even the branch of an `if` it didn't take. Later the engine
	 * could keep only the references the last compute read (the active ones),
	 * so that a change on the branch not taken doesn't make it pending.
	 */
	readonly dependents: Set<Cell>;
	/** The cells it reads that may have changed since it was last clean. */
	readonly suspects: Set<Cell>;
	/** Called when a cell this one reads changed its value, before this one becomes dirty. */
	onDirtyDependency?: (dependency: Cell) => void;
}

/**
 * Creates an engine over a plan, reading inputs and list elements from the
 * log. A cell exists only for what has been read.
 */
export function createEngine(plan: Plan, log: Log): Engine {
	const cells = new Map<string, Cell>();
	const watched = new Set<Cell>();

	const get = (cell: Cell): Result<unknown> => {
		if (cell.busy) {
			return fail("cycle", "this value depends on itself", cell.at);
		}
		if (cell.state === "clean" && cell.value) return cell.value;
		cell.busy = true;
		try {
			// A suspect whose value changes makes this cell dirty.
			for (const suspect of cell.suspects) {
				if (suspect.state !== "clean") get(suspect);
			}
			cell.suspects.clear();
			if (cell.state === "dirty" || !cell.value) {
				const before = cell.value;
				cell.value = cell.compute();
				if (before && !same(before, cell.value)) {
					for (const d of cell.dependents) {
						d.onDirtyDependency?.(cell);
						d.state = "dirty";
					}
				}
			}
			cell.state = "clean";
		} finally {
			cell.busy = false;
		}
		return cell.value;
	};

	const depend = (cell: Cell, on: Cell): Result<unknown> => {
		on.dependents.add(cell);
		return get(on);
	};

	/** Makes everything that depends on a cell pending, with the path back as suspects. */
	const suspect = (cell: Cell): void => {
		for (const d of cell.dependents) {
			d.suspects.add(cell);
			if (d.state === "clean") {
				d.state = "pending";
				suspect(d);
			}
		}
	};

	const cellAt = (at: Address): Cell => {
		const k = key(at);
		let cell = cells.get(k);
		if (!cell) {
			cell = makeCell(at);
			cells.set(k, cell);
		}
		return cell;
	};

	const makeCell = (at: Address): Cell => {
		const found = locate(plan, at);
		const owner = at.slice(0, -1);
		if (found?.kind === "input") {
			const read =
				found.input.kind === "list"
					? () => ok(log.members(at))
					: () => ok(log.input(at));
			return newCell(at, read);
		}
		if (found?.kind === "value") {
			const { refs, compute } = found.value;
			// Made on first compute, so two values that read each other don't recurse here.
			let deps: Cell[] | undefined;
			const cell: Cell = newCell(at, () => {
				deps ??= refs.map((ref, i) => refCell(ref, owner, at, i));
				const args: unknown[] = [];
				for (const dep of deps) {
					const r = depend(cell, dep);
					if (!r.ok) return caused(r.error, at);
					args.push(r.value);
				}
				const r = compute(args);
				return r.ok || r.error.at.length > 0
					? r
					: fail(r.error.code, r.error.message, at);
			});
			return cell;
		}
		return newCell(at, () =>
			fail("ref.unknown", "nothing is at this address", at),
		);
	};

	/** The cell a reference reads, from the instance that holds the value. */
	const refCell = (
		ref: Ref,
		owner: Address,
		valueAt: Address,
		i: number,
	): Cell => {
		if (ref.kind === "member") return cellAt([...owner, ref.name]);
		const k = `${key(valueAt)}#${i}`;
		let cell = cells.get(k);
		if (!cell) {
			cell = foldCell([...owner, ref.list], ref.member, ref.aggregate);
			cells.set(k, cell);
		}
		return cell;
	};

	/**
	 * A fold over one member of every element of a list. It keeps each
	 * element's last value, so a change to one element removes the old value
	 * from the accumulator and adds the new one; a change to the list adds and
	 * removes whole elements.
	 */
	const foldCell = (list: Address, member: string, aggregate: Fold): Cell => {
		const members = cellAt(list);
		const values = new Map<string, Result<unknown>>();
		const changed = new Set<string>();
		let acc: unknown;
		let started = false;
		let errors = 0;

		const take = (r: Result<unknown>, sign: 1 | -1) => {
			if (r.ok) {
				acc =
					sign === 1
						? aggregate.add(acc, r.value)
						: aggregate.remove(acc, r.value);
			} else errors += sign;
		};

		const cell: Cell = newCell([...list, "$each", member], () => {
			if (!started) {
				acc = aggregate.init();
				started = true;
			}
			const ids = depend(cell, members);
			const now = new Set(ids.ok ? (ids.value as string[]) : []);
			for (const [id, r] of values) {
				if (!now.has(id)) {
					take(r, -1);
					values.delete(id);
					cellAt([...list, id, member]).dependents.delete(cell);
				}
			}
			for (const id of now) {
				const old = values.get(id);
				if (old && !changed.has(id)) continue;
				if (old) take(old, -1);
				const r = depend(cell, cellAt([...list, id, member]));
				values.set(id, r);
				take(r, 1);
			}
			changed.clear();
			if (errors > 0) {
				const first = [...values.values()].find((r) => !r.ok);
				if (first && !first.ok) return caused(first.error, cell.at);
			}
			return ok(aggregate.result(acc));
		});
		cell.onDirtyDependency = (dependency) => {
			const id = dependency.at[list.length];
			if (dependency !== members && id !== undefined) changed.add(id);
		};
		return cell;
	};

	return {
		read: (at) => get(cellAt(at)),

		watch(at) {
			const cell = cellAt(at);
			cell.watchers++;
			watched.add(cell);
			get(cell);
		},

		unwatch(at) {
			const cell = cells.get(key(at));
			if (!cell || cell.watchers === 0) return;
			cell.watchers--;
			if (cell.watchers === 0) watched.delete(cell);
		},

		invalidate(changes) {
			for (const change of changes) {
				const cell = cells.get(key(change.at));
				if (!cell) continue;
				cell.state = "dirty";
				suspect(cell);
			}
		},

		settle() {
			// Note every value first: settling one can settle another it reads.
			const stale: [Cell, Result<unknown> | undefined][] = [];
			for (const cell of watched) {
				if (cell.state !== "clean") stale.push([cell, cell.value]);
			}
			const changed: Address[] = [];
			for (const [cell, before] of stale) {
				const after = get(cell);
				if (!before || !same(before, after)) changed.push(cell.at);
			}
			return changed;
		},

		resolveWrite(at, value) {
			const found = locate(plan, at);
			if (found?.kind === "input" && found.input.kind === "value") {
				return ok({ at, v: value });
			}
			return fail("write.readonly", "this value can't be set", at);
		},
	};
}

function newCell(at: Address, compute: () => Result<unknown>): Cell {
	return {
		at,
		compute,
		value: undefined,
		state: "dirty",
		busy: false,
		watchers: 0,
		dependents: new Set(),
		suspects: new Set(),
	};
}

function key(at: Address): string {
	return JSON.stringify(at);
}

/** A value fails because a value it reads failed: same code, and the cause attached. */
function caused(error: ThenceError, at: Address): Result<never> {
	return {
		ok: false,
		error: { code: error.code, message: error.message, at, cause: error },
	};
}
