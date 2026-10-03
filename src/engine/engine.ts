import type { Change, Log } from "../log";
import { type Address, locate, type Plan, type Ref, type Step } from "../plan";
import { fail, ok, type Result } from "../values";
import {
	type Cell,
	type Cells,
	ComputedCell,
	caused,
	FoldCell,
	LookupCell,
	PlaceCell,
} from "./cell";
import { same } from "./same";
import type { Engine } from "./types";

/**
 * An engine over a plan, reading inputs and collection elements from the log.
 * A cell exists only for what has been read.
 */
export class CellEngine implements Engine {
	readonly #plan: Plan;
	readonly #log: Log;
	/** Every cell made so far, by address; a reference's own cell by the value it belongs to. */
	readonly #cells = new Map<string, Cell>();
	readonly #watched = new Set<Cell>();
	/** What lookups need from the engine. */
	readonly #lookups: Cells = {
		cellAt: (at) => this.#cellAt(at),
		collection: (at) => this.#collection(at),
	};

	constructor(plan: Plan, log: Log) {
		this.#plan = plan;
		this.#log = log;
	}

	read(at: Address): Result<unknown> {
		return this.#cellAt(at).get();
	}

	watch(at: Address): void {
		const cell = this.#cellAt(at);
		cell.watchers++;
		this.#watched.add(cell);
		cell.get();
	}

	unwatch(at: Address): void {
		const cell = this.#cells.get(key(at));
		if (!cell || cell.watchers === 0) return;
		cell.watchers--;
		if (cell.watchers === 0) this.#watched.delete(cell);
	}

	invalidate(changes: readonly Change[]): void {
		for (const change of changes) this.#cells.get(key(change.at))?.invalidate();
	}

	settle(): readonly Address[] {
		// Note every value first: settling one can settle another it reads.
		const stale: [Cell, Result<unknown> | undefined][] = [];
		for (const cell of this.#watched) {
			if (cell.state !== "clean") stale.push([cell, cell.value]);
		}
		const changed: Address[] = [];
		for (const [cell, before] of stale) {
			const after = cell.get();
			if (!before || !same(before, after)) changed.push(cell.at);
		}
		return changed;
	}

	resolveWrite(
		at: Address,
		value: unknown,
	): Result<{ at: Address; v: unknown }> {
		const found = locate(this.#plan, at);
		if (found?.kind === "input" && found.input.kind === "value") {
			return ok({ at, v: value });
		}
		return fail("write.readonly", "this value can't be set", at);
	}

	#cellAt(at: Address): Cell {
		const k = key(at);
		let cell = this.#cells.get(k);
		if (!cell) {
			cell = this.#makeCell(at);
			this.#cells.set(k, cell);
		}
		return cell;
	}

	#makeCell(at: Address): Cell {
		const found = locate(this.#plan, at);
		const log = this.#log;
		if (found?.kind === "input") {
			return new ComputedCell(at, () =>
				ok(found.input.kind === "value" ? log.input(at) : log.members(at)),
			);
		}
		if (found?.kind === "placed") {
			const ids = ok(found.placed.elements.map((e) => e.id));
			return new ComputedCell(at, () => ids);
		}
		if (found?.kind === "value") {
			const { refs, compute } = found.value;
			const owner = at.slice(0, -1);
			// Found on first compute, so two values that read each other don't recurse here.
			let deps: Cell[] | undefined;
			return new ComputedCell(at, (read) => {
				deps ??= refs.map((ref, i) => this.#refCell(ref, owner, at, i));
				const args: unknown[] = [];
				for (const dep of deps) {
					const r = read(dep);
					if (!r.ok) return caused(r.error, at);
					args.push(r.value);
				}
				const r = compute(args);
				return r.ok || r.error.at.length > 0
					? r
					: fail(r.error.code, r.error.message, at);
			});
		}
		return new ComputedCell(at, () =>
			fail("ref.unknown", "nothing is at this address", at),
		);
	}

	/** The cell a reference reads, from the instance that holds the value. */
	#refCell(ref: Ref, owner: Address, valueAt: Address, i: number): Cell {
		if (ref.kind === "member") return this.#cellAt([...owner, ...ref.path]);
		const k = `${key(valueAt)}#${i}`;
		let cell = this.#cells.get(k);
		if (!cell) {
			cell = this.#makeRefCell(ref, owner);
			this.#cells.set(k, cell);
		}
		return cell;
	}

	#makeRefCell(ref: Exclude<Ref, { kind: "member" }>, owner: Address): Cell {
		switch (ref.kind) {
			case "lookup":
				return new LookupCell(owner, ref.path, this.#lookups);
			case "place":
				return new PlaceCell(owner, ref.of, this.#lookups);
			case "fold": {
				const list = [...owner, ...ref.list];
				const each = ref.each;
				const direct = each.every((s) => typeof s === "string");
				return new FoldCell(
					list,
					each,
					this.#cellAt(list),
					(id) =>
						direct
							? this.#cellAt([...list, id, ...(each as string[])])
							: this.#elementLookup([...list, id], each),
					ref.aggregate,
				);
			}
		}
	}

	/** A lookup from one element, kept so that every fold over the element shares it. */
	#elementLookup(element: Address, each: readonly Step[]): Cell {
		const k = `${key(element)}~${JSON.stringify(each)}`;
		let cell = this.#cells.get(k);
		if (!cell) {
			cell = new LookupCell(element, each, this.#lookups);
			this.#cells.set(k, cell);
		}
		return cell;
	}

	#collection(at: Address): "list" | "map" | undefined {
		const found = locate(this.#plan, at);
		if (found?.kind === "placed") return found.placed.kind;
		if (found?.kind === "input" && found.input.kind !== "value") {
			return found.input.kind;
		}
		return undefined;
	}
}

function key(at: Address): string {
	return JSON.stringify(at);
}
