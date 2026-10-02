/**
 * engine: computes values from the plan and the log. A cell exists only for
 * what has been read, a change marks the cells that depend on it dirty, and
 * `settle` recomputes the watched ones. Aggregates fold a collection one
 * element at a time.
 *
 * So far what the walking skeleton needs: inputs, values computed from the
 * entity's own members, and folds over a list. No cycles, eviction or
 * `explain` yet.
 *
 * @module
 */

import type { Change, Log } from "../log";
import { type Address, type Fold, locate, type Plan, type Ref } from "../plan";
import { Decimal, type Result, type ThenceError } from "../values";

export interface Engine {
	/** The value at an address now, computing what it needs. */
	read(at: Address): Result<unknown>;
	/** Keeps a value up to date: `settle` recomputes it and reports when it changes. */
	watch(at: Address): void;
	unwatch(at: Address): void;
	/** Marks everything that depends on the changed inputs dirty. Computes nothing. */
	invalidate(changes: readonly Change[]): void;
	/** Recomputes the dirty watched values and returns those whose value changed. */
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

interface Cell {
	readonly at: Address;
	readonly compute: () => Result<unknown>;
	value: Result<unknown> | undefined;
	dirty: boolean;
	computing: boolean;
	watchers: number;
	readonly dependents: Set<Cell>;
	/** Called when a cell this one depends on becomes dirty, before this one does. */
	onDirty?: (from: Cell) => void;
}

/** Creates an engine over a plan, reading inputs and list elements from the log. */
export function createEngine(plan: Plan, log: Log): Engine {
	const cells = new Map<string, Cell>();

	const get = (cell: Cell): Result<unknown> => {
		if (cell.value && !cell.dirty) return cell.value;
		if (cell.computing) {
			return fail("cycle", "this value depends on itself", cell.at);
		}
		cell.computing = true;
		try {
			cell.value = cell.compute();
		} finally {
			cell.computing = false;
		}
		cell.dirty = false;
		return cell.value;
	};

	const depend = (cell: Cell, on: Cell): Result<unknown> => {
		on.dependents.add(cell);
		return get(on);
	};

	const markDirty = (cell: Cell, from?: Cell): void => {
		if (from) cell.onDirty?.(from);
		if (cell.dirty) return;
		cell.dirty = true;
		for (const d of cell.dependents) markDirty(d, cell);
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
		cell.onDirty = (from) => {
			const id = from.at[list.length];
			if (from !== members && id !== undefined) changed.add(id);
		};
		return cell;
	};

	return {
		read: (at) => get(cellAt(at)),

		watch(at) {
			const cell = cellAt(at);
			cell.watchers++;
			get(cell);
		},

		unwatch(at) {
			const cell = cells.get(key(at));
			if (cell && cell.watchers > 0) cell.watchers--;
		},

		invalidate(changes) {
			for (const change of changes) {
				const cell = cells.get(key(change.at));
				if (cell) markDirty(cell);
			}
		},

		settle() {
			const changed: Address[] = [];
			for (const cell of cells.values()) {
				if (cell.watchers === 0 || !cell.dirty) continue;
				const before = cell.value;
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
		dirty: true,
		computing: false,
		watchers: 0,
		dependents: new Set(),
	};
}

/** Whether two results hold the same value, so subscribers needn't hear about it. */
export function same(a: Result<unknown>, b: Result<unknown>): boolean {
	if (a.ok !== b.ok) return false;
	if (!a.ok || !b.ok) {
		return (
			!a.ok &&
			!b.ok &&
			a.error.code === b.error.code &&
			key(a.error.at) === key(b.error.at)
		);
	}
	if (a.value instanceof Decimal && b.value instanceof Decimal) {
		return a.value.equals(b.value) && a.value.scale === b.value.scale;
	}
	if (typeof a.value === "object" && a.value !== null) {
		return JSON.stringify(a.value) === JSON.stringify(b.value);
	}
	return Object.is(a.value, b.value);
}

function key(at: Address | readonly unknown[]): string {
	return JSON.stringify(at);
}

function ok<T>(value: T): Result<T> {
	return { ok: true, value };
}

function fail(code: string, message: string, at: Address): Result<never> {
	return { ok: false, error: { code, message, at } };
}

/** A value fails because a value it reads failed: same code, and the cause attached. */
function caused(error: ThenceError, at: Address): Result<never> {
	return {
		ok: false,
		error: { code: error.code, message: error.message, at, cause: error },
	};
}
