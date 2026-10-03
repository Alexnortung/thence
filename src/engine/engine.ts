import type { Change, Log } from "../log";
import {
	type Address,
	canonical,
	encode,
	type Located,
	locate,
	type Plan,
	type Ref,
	type Stage,
	type Step,
	sourceOf,
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
	SKIP,
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
	/**
	 * What is watched, by the address it was watched at, which may not be
	 * where its cell is: a filter's element is computed at its source.
	 */
	readonly #watched = new Map<
		string,
		{ readonly at: Address; readonly cell: Cell; count: number }
	>();
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
		const k = key(at);
		const w = this.#watched.get(k);
		if (w) w.count++;
		else this.#watched.set(k, { at, cell, count: 1 });
		cell.get();
	}

	unwatch(at: Address): void {
		const k = key(at);
		const w = this.#watched.get(k);
		if (!w) return;
		w.cell.watchers--;
		if (--w.count === 0) this.#watched.delete(k);
	}

	invalidate(changes: readonly Change[]): void {
		for (const change of changes) this.#cells.get(key(change.at))?.invalidate();
	}

	settle(): readonly Address[] {
		// Note every value first: settling one can settle another it reads.
		const stale: [Address, Cell, Result<unknown> | undefined][] = [];
		for (const { at, cell } of this.#watched.values()) {
			if (cell.state !== "clean") stale.push([at, cell, cell.value]);
		}
		const changed: Address[] = [];
		for (const [at, cell, before] of stale) {
			const after = cell.get();
			if (!before || !same(before, after)) changed.push(at);
		}
		return changed;
	}

	resolveWrite(at: Address, value: unknown): Result<{ at: Address; v: Json }> {
		// A filter's element is its source's: the op goes there.
		return this.#write(canonical(this.#plan, at), value, false, new Set());
	}

	writable(at: Address): boolean {
		return this.#writable(canonical(this.#plan, at), new Set());
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
		const { plan, context } = inverse;
		const target = this.#target(at, value);
		if (!target.ok) return target;
		// The other references at their values now; the one written to may be empty or failing.
		const args: unknown[] = [];
		for (const [i, ref] of found.value.refs.entries()) {
			const r = this.#refCell(ref, context, at, i).get();
			if (!r.ok && i !== plan.ref) return caused(r.error, at);
			args.push(r.ok ? r.value : null);
		}
		const answer = plan.value(target.value, args);
		if (!answer.ok) return fail(answer.error.code, answer.error.message, at);
		const next = this.#refTarget(
			found.value.refs[plan.ref],
			context,
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
		const { refs, inverse, cycle } = found.value;
		// Working back through a cycle would ignore what the write changes in it.
		if (!inverse || cycle) return undefined;
		const context = this.#context(at, found);
		const k = key(at);
		seen.add(k);
		try {
			const plan = inverse((i) => {
				const next = this.#refTarget(refs[i], context, at, i);
				return next !== undefined && this.#writable(next, seen);
			});
			return plan && { plan, context };
		} finally {
			seen.delete(k);
		}
	}

	/** The address a reference reads now: for a lookup, where its path leads; `undefined` for anything else. */
	#refTarget(
		ref: Ref | undefined,
		context: Context,
		valueAt: Address,
		i: number,
	): Address | undefined {
		if (ref?.kind === "member") {
			return canonical(this.#plan, this.#refCell(ref, context, valueAt, i).at);
		}
		if (ref?.kind !== "lookup") return undefined;
		const cell = this.#refCell(ref, context, valueAt, i);
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

	/**
	 * The cell for an address. A filter's element is its source's element, so
	 * its cells are the source's, found under either address.
	 */
	#cellAt(at: Address): Cell {
		const k = key(at);
		let cell = this.#cells.get(k);
		if (!cell) {
			const there = canonical(this.#plan, at);
			cell =
				there.length === at.length && key(there) === k
					? this.#makeCell(at)
					: this.#cellAt(there);
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
		if (found?.kind === "derived") {
			// Its ids: a fold over the source, in the instance that holds it.
			const holder = at.slice(0, -1);
			const members = this.#refCell(
				found.derived.members,
				{ owner: holder },
				at,
				0,
			);
			return new ComputedCell(at, (read) => read(members));
		}
		if (found?.kind === "value" && found.value.cycle) {
			// Computed with the rest of its cycle, which one cell iterates.
			const owner = ownerOf(at, found);
			const members = found.value.cycle.members.map((m) => [
				...owner.slice(0, owner.length - m.up),
				...m.path,
			]);
			const i = members.findIndex((m) => key(m) === key(at));
			const group = this.#cycleCell(members);
			return new ComputedCell(at, (read) => {
				const r = read(group);
				return r.ok ? ((r.value as Result<unknown>[])[i] ?? r) : r;
			});
		}
		if (found?.kind === "value") {
			const { refs, compute } = found.value;
			const context = this.#context(at, found);
			// Found on first compute, so two values that read each other don't recurse here.
			let deps: Cell[] | undefined;
			return new ComputedCell(at, (read) => {
				deps ??= refs.map((ref, i) => this.#refCell(ref, context, at, i));
				const args: unknown[] = [];
				for (const dep of deps) {
					const r = read(dep);
					if (!r.ok) return caused(r.error, at);
					args.push(r.value);
				}
				return located(compute(args), at);
			});
		}
		return new ComputedCell(at, () =>
			fail("ref.unknown", "nothing is at this address", at),
		);
	}

	/**
	 * Where a value's references start: the instance that holds it (a
	 * trait's member sits after its "as:…" segment) and, for a value of an
	 * element a `map` built, the source's element its `param` references
	 * read.
	 */
	#context(at: Address, found: Extract<Located, { kind: "value" }>): Context {
		const owner = ownerOf(at, found);
		const collection = owner.slice(0, -1);
		const derived = collection.length > 0 && locate(this.#plan, collection);
		if (derived && derived.kind === "derived" && derived.derived.shape) {
			const holder = collection.slice(0, -1);
			const id = owner[owner.length - 1] as string;
			return {
				owner,
				element: [...sourceOf(holder, derived.derived), id],
			};
		}
		return { owner };
	}

	/**
	 * The cell that computes a cycle's values together, as a list of results
	 * in the order of `members`. It reads the values outside the cycle as
	 * any cell does, so a change to one of them computes the cycle again,
	 * from its seeds.
	 */
	#cycleCell(members: readonly Address[]): Cell {
		const k = `cycle:${key(members[0] ?? [])}`;
		let cell = this.#cells.get(k);
		if (!cell) {
			cell = new ComputedCell(members[0] ?? [], (read) =>
				this.#iterate(members, read),
			);
			this.#cells.set(k, cell);
		}
		return cell;
	}

	/**
	 * Computes a cycle: every value starts from its seed, and each round
	 * computes them in order, each from the values so far, until a round
	 * changes none of them. After {@link ROUNDS} rounds, every value of the
	 * cycle is `cycle.nonconvergent`.
	 */
	#iterate(
		members: readonly Address[],
		read: (dependency: Cell) => Result<unknown>,
	): Result<Result<unknown>[]> {
		const index = new Map(members.map((m, i) => [key(m), i]));
		const values: Result<unknown>[] = [];
		const parts = members.map((at, i) => {
			const found = locate(this.#plan, at);
			const plan = found?.kind === "value" ? found.value : undefined;
			values.push(ok(plan?.cycle?.seed ?? null));
			if (!plan || found?.kind !== "value") return undefined;
			const context = this.#context(at, found);
			// Another value of the cycle is read from this round; anything else from its cell.
			const deps = plan.refs.map((ref, j) => {
				const cell = this.#refCell(ref, context, at, j);
				const member =
					ref.kind === "member" ? index.get(key(cell.at)) : undefined;
				return member ?? cell;
			});
			return { at, plan, deps, i };
		});
		for (let round = 0; round < ROUNDS; round++) {
			let changed = false;
			for (const part of parts) {
				if (!part) continue;
				const { at, plan, deps, i } = part;
				let r: Result<unknown> | undefined;
				const args: unknown[] = [];
				for (const dep of deps) {
					const v =
						typeof dep === "number"
							? (values[dep] as Result<unknown>)
							: read(dep);
					if (!v.ok) {
						r = caused(v.error, at);
						break;
					}
					args.push(v.value);
				}
				r ??= located(plan.compute(args), at);
				if (!close(values[i] as Result<unknown>, r, plan.cycle?.converge)) {
					values[i] = r;
					changed = true;
				}
			}
			if (!changed) return ok(values);
		}
		return ok(
			members.map((at) =>
				fail(
					"cycle.nonconvergent",
					`this value is in a cycle that didn't settle in ${ROUNDS} rounds`,
					at,
				),
			),
		);
	}

	/**
	 * The cell a reference reads: from the instance that holds the value, or
	 * for a `param` reference from the element. `valueAt` and `i` name the
	 * reference, so a value's lookups and folds keep their own cells.
	 */
	#refCell(ref: Ref, context: Context, valueAt: Address, i: number): Cell {
		return this.#cellFor(ref, context, `${key(valueAt)}#${i}`);
	}

	/** The cell a reference reads, under a key of its own for anything but a member. */
	#cellFor(ref: Ref, context: Context, k: string): Cell {
		if (ref.kind === "param") {
			// Only a lambda over values has one, and it is never given a cell.
			return new ComputedCell([], () =>
				fail("ref.unknown", "a lambda's parameter has no address", []),
			);
		}
		const { owner, element } = context;
		const base =
			"param" in ref && ref.param && element
				? element
				: "up" in ref && ref.up !== undefined
					? owner.slice(0, owner.length - ref.up)
					: owner;
		if (ref.kind === "member") return this.#cellAt([...base, ...ref.path]);
		let cell = this.#cells.get(k);
		if (!cell) {
			cell = this.#makeRefCell(ref, base, owner, k);
			this.#cells.set(k, cell);
		}
		return cell;
	}

	#makeRefCell(
		ref: Exclude<Ref, { kind: "member" } | { kind: "param" }>,
		base: Address,
		owner: Address,
		k: string,
	): Cell {
		switch (ref.kind) {
			case "lookup":
				return new LookupCell(base, ref.path, this.#lookups);
			case "place":
				return new PlaceCell(base, ref.of, this.#lookups);
			case "fold": {
				const list = [...base, ...ref.list];
				const { each, stages } = ref;
				const direct = each.every((s) => typeof s === "string");
				return new FoldCell(
					list,
					each,
					this.#cellAt(list),
					(id) =>
						stages
							? this.#stageCell([...list, id], stages, owner, `${k}@${id}`)
							: direct
								? this.#cellAt([...list, id, ...(each as string[])])
								: this.#elementLookup([...list, id], each),
					ref.aggregate,
				);
			}
		}
	}

	/**
	 * The lambdas of a `map` or `filter` for one element: a cell of its own
	 * per element and fold, so a change to one element runs them for that
	 * element only. Its value is the last map's, the element's id without
	 * one, or {@link SKIP} when a filter leaves the element out.
	 */
	#stageCell(
		element: Address,
		stages: readonly Stage[],
		owner: Address,
		k: string,
	): Cell {
		const id = element[element.length - 1] as string;
		const context: Context = { owner, element };
		return new ComputedCell(element, (read) => {
			let value: unknown = id;
			for (const [s, stage] of stages.entries()) {
				const args: unknown[] = [];
				for (const [j, ref] of stage.refs.entries()) {
					if (ref.kind === "param") {
						args.push(value);
						continue;
					}
					// A reference outside the lambda is the same for every element.
					const shared = !("param" in ref && ref.param);
					const r = read(
						this.#cellFor(
							ref,
							context,
							shared
								? `${k.slice(0, k.lastIndexOf("@"))}#${s}.${j}`
								: `${k}#${s}.${j}`,
						),
					);
					if (!r.ok) return caused(r.error, element);
					args.push(r.value);
				}
				const r = located(stage.compute(args), element);
				if (!r.ok) return r;
				if (stage.kind === "map") value = r.value;
				else if (r.value !== true) return ok(SKIP);
			}
			return ok(value);
		});
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
		if (found?.kind === "derived") return found.derived.collection;
		if (found?.kind === "input" && found.input.kind !== "value") {
			return found.input.kind;
		}
		return undefined;
	}
}

/**
 * Where a value's references start: `owner`, the instance that holds it,
 * and for `param` references, `element`.
 */
interface Context {
	readonly owner: Address;
	readonly element?: Address;
}

/** A computed result; an error without an address gets the value's. */
function located(r: Result<unknown>, at: Address): Result<unknown> {
	return r.ok || r.error.at.length > 0
		? r
		: fail(r.error.code, r.error.message, at);
}

/** The most rounds a cycle is computed before it is `cycle.nonconvergent`. */
const ROUNDS = 100;

/**
 * Whether two rounds of a cycle gave the same value: bitwise, or within the
 * type's `converge` tolerance for numbers.
 */
function close(
	a: Result<unknown>,
	b: Result<unknown>,
	converge: { readonly abs?: number; readonly rel?: number } | undefined,
): boolean {
	if (
		converge &&
		a.ok &&
		b.ok &&
		typeof a.value === "number" &&
		typeof b.value === "number"
	) {
		const d = Math.abs(a.value - b.value);
		return (
			d <= (converge.abs ?? 0) || d <= (converge.rel ?? 0) * Math.abs(b.value)
		);
	}
	return same(a, b);
}

/** The instance a value is computed in: a trait's member sits after its "as:…" segment. */
function ownerOf(
	at: Address,
	found: Extract<Located, { kind: "value" }>,
): Address {
	return at.slice(0, found.trait === undefined ? -1 : -2);
}

function key(at: Address): string {
	return JSON.stringify(at);
}
