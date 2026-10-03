import type { Change, Log } from "../log";
import {
	type Address,
	type Located,
	locate,
	type Plan,
	type Ref,
	type Step,
	type ValueTypePlan,
} from "../plan";
import { Decimal, fail, type Json, ok, type Result } from "../values";
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

	resolveWrite(at: Address, value: unknown): Result<{ at: Address; v: Json }> {
		return this.#write(at, value, false, new Set());
	}

	writable(at: Address): boolean {
		return this.#writable(at, new Set());
	}

	/**
	 * Follows a write down to an input. `through` is set once it has gone
	 * through an inverse, which may give a value the input's type rounds.
	 * `seen` holds the values on the way, so a cycle doesn't recurse.
	 */
	#write(
		at: Address,
		value: unknown,
		through: boolean,
		seen: Set<string>,
	): Result<{ at: Address; v: Json }> {
		const found = locate(this.#plan, at);
		if (found?.kind === "input" && found.input.kind === "value") {
			return ok({ at, v: encode(found.input.type, value, through) });
		}
		const k = key(at);
		const inverse =
			found?.kind === "value" && !seen.has(k)
				? this.#inverse(at, found, seen)
				: undefined;
		if (!inverse || found?.kind !== "value") {
			return fail("write.readonly", "this value can't be set", at);
		}
		const { plan, owner } = inverse;
		const target = this.#target(at, value);
		if (!target.ok) return target;
		// The other references at their values now; the one written to may be empty or failing.
		const args: unknown[] = [];
		for (const [i, ref] of found.value.refs.entries()) {
			const r = this.#refCell(ref, owner, at, i).get();
			if (!r.ok && i !== plan.ref) return caused(r.error, at);
			args.push(r.ok ? r.value : null);
		}
		const answer = plan.value(target.value, args);
		if (!answer.ok) return fail(answer.error.code, answer.error.message, at);
		const next = this.#refTarget(
			found.value.refs[plan.ref],
			owner,
			at,
			plan.ref,
		);
		if (!next) return fail("write.readonly", "this value can't be set", at);
		seen.add(k);
		try {
			return this.#write(next, answer.value, true, seen);
		} finally {
			seen.delete(k);
		}
	}

	/** Whether a write to `at` reaches an input. */
	#writable(at: Address, seen: Set<string>): boolean {
		const found = locate(this.#plan, at);
		if (found?.kind === "input") return found.input.kind === "value";
		const k = key(at);
		return (
			found?.kind === "value" &&
			!seen.has(k) &&
			this.#inverse(at, found, seen) !== undefined
		);
	}

	/** How a write to a value goes back through its expression, if it does. */
	#inverse(
		at: Address,
		found: Extract<Located, { kind: "value" }>,
		seen: Set<string>,
	) {
		const { refs, inverse } = found.value;
		if (!inverse) return undefined;
		const owner = ownerOf(at, found);
		const k = key(at);
		seen.add(k);
		try {
			const plan = inverse((i) => {
				const next = this.#refTarget(refs[i], owner, at, i);
				return next !== undefined && this.#writable(next, seen);
			});
			return plan && { plan, owner };
		} finally {
			seen.delete(k);
		}
	}

	/** The address a reference reads now: for a lookup, where its path leads; `undefined` for anything else. */
	#refTarget(
		ref: Ref | undefined,
		owner: Address,
		valueAt: Address,
		i: number,
	): Address | undefined {
		if (ref?.kind === "member") return this.#refCell(ref, owner, valueAt, i).at;
		if (ref?.kind !== "lookup") return undefined;
		const cell = this.#refCell(ref, owner, valueAt, i);
		cell.get();
		return cell instanceof LookupCell ? cell.target?.at : undefined;
	}

	/**
	 * What the Operator wrote, as the value holds it now: text or a number
	 * written to a decimal becomes one at its scale, and a decimal written to
	 * a number becomes one.
	 */
	#target(at: Address, value: unknown): Result<unknown> {
		const now = this.#cellAt(at).get();
		const current = now.ok ? now.value : undefined;
		if (current instanceof Decimal && !(value instanceof Decimal)) {
			const d =
				typeof value === "string"
					? Decimal.parse(value, current.scale)
					: typeof value === "number" && Number.isFinite(value)
						? Decimal.from(value, current.scale)
						: undefined;
			return d || value === null
				? ok(d ?? null)
				: fail("op.type", `${JSON.stringify(value)} isn't a decimal`, at);
		}
		if (typeof current === "number" && value instanceof Decimal) {
			return ok(value.toNumber());
		}
		return ok(value);
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
			// A trait's member sits after its "as:…" segment, and is computed in the instance's scope.
			const owner = ownerOf(at, found);
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
		const base =
			"up" in ref && ref.up !== undefined
				? owner.slice(0, owner.length - ref.up)
				: owner;
		if (ref.kind === "member") return this.#cellAt([...base, ...ref.path]);
		const k = `${key(valueAt)}#${i}`;
		let cell = this.#cells.get(k);
		if (!cell) {
			cell = this.#makeRefCell(ref, base);
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

	#collection(at: Address): "list" | "map" | "choice" | undefined {
		const found = locate(this.#plan, at);
		if (found?.kind === "placed") return found.placed.kind;
		if (found?.kind === "input" && found.input.kind !== "value") {
			return found.input.kind;
		}
		return undefined;
	}
}

/** The instance a value is computed in: a trait's member sits after its "as:…" segment. */
function ownerOf(
	at: Address,
	found: Extract<Located, { kind: "value" }>,
): Address {
	return at.slice(0, found.trait === undefined ? -1 : -2);
}

/**
 * A value as an op writes it to an input of this type. A decimal is written
 * at the input's scale. After an inverse, a number for an `int` is rounded,
 * as the README's "Rounding" says: the derived value is computed again from
 * what the input holds.
 */
function encode(type: ValueTypePlan, value: unknown, through: boolean): Json {
	if (value instanceof Decimal) {
		if (type.base === "decimal") {
			return value.rescale(type.scale ?? value.scale).toJSON();
		}
		if (type.base === "int") return value.rescale(0).toNumber();
		if (type.base === "number") return value.toNumber();
		return value.toJSON();
	}
	if (through && type.base === "int" && typeof value === "number") {
		return Math.round(value);
	}
	return value as Json;
}

function key(at: Address): string {
	return JSON.stringify(at);
}
