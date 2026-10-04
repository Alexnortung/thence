import type { Diagnostic, Part } from "../checker";
import { CellEngine, type Engine, same } from "../engine";
import { type Intent, type Log, type Op, OpLog } from "../log";
import {
	type Address,
	type Check,
	locate,
	type Plan,
	parentOf,
	type ReadPath,
	reads,
	traitSegment,
	values,
} from "../plan";
import { fail, type Json, type Path, type Result } from "../values";
import type { EnumOption } from "./handles";
import {
	LiveChoice,
	LiveEntity,
	LiveList,
	LiveMap,
	LiveMember,
	LiveTrait,
	later,
} from "./live";
import type { Program, RunOptions } from "./program";
import type { Issue, Session } from "./session";

/** The program `kit.program(tree)` returns, over a checked plan. */
export class CheckedProgram implements Program<any> {
	readonly #plan: Plan;
	readonly #parts: readonly Part[];

	constructor(
		plan: Plan,
		readonly diagnostics: readonly Diagnostic[],
		parts: readonly Part[] = [],
	) {
		this.#plan = plan;
		this.#parts = parts;
	}

	run(ops: readonly Op[] = [], options: RunOptions = {}): Session<any> {
		return new LiveSession(
			new Runtime(this.#plan, options.replica ?? randomReplica(), ops),
		);
	}

	parts(): any[] {
		return this.#parts.map(({ path, node }) => ({ ...node, path }));
	}

	/**
	 * What the value at `path` reads. For an entity the program placed: what
	 * its values read outside it.
	 */
	dependencies(path: Path): readonly Path[] {
		const at = staticAddress(path);
		const inside = (p: ReadPath) => startsWith(p, at);
		const found = locate(this.#plan, at);
		const from =
			found?.kind === "instance"
				? values(this.#plan).filter((v) => startsWith(v, at))
				: [at];
		return unique(from.flatMap((v) => reads(this.#plan, v))).filter(
			(p) => found?.kind !== "instance" || !inside(p),
		);
	}

	/**
	 * The values that read the member at `path`, or anything inside the
	 * entity or collection there. Values in elements an Operator adds have
	 * no address, so only what reads them through a collection shows.
	 */
	dependents(path: Path): readonly Path[] {
		const at = staticAddress(path);
		return values(this.#plan).filter(
			(v) =>
				!startsWith(v, at) &&
				reads(this.#plan, v).some((p) => startsWith(p, at)),
		);
	}
}

/** A running session: the Operator's side of a {@link Runtime}. */
class LiveSession implements Session<any> {
	readonly #runtime: Runtime;

	constructor(runtime: Runtime) {
		this.#runtime = runtime;
	}

	get root(): any {
		return this.#runtime.entity([]);
	}

	at(path: Path): any {
		const r = this.#runtime;
		const at = r.address(path);
		const found = at && locate(r.plan, at);
		if (!at || !found) return undefined;
		if (found.kind === "instance") return r.entity(at);
		const collection = r.collection(at);
		if (collection === "list") return r.list(at);
		if (collection === "map") return r.map(at);
		return r.member(at);
	}

	issues(): readonly Issue[] {
		return this.#runtime.entity([]).issues();
	}

	apply(op: Op | readonly Op[]): void {
		const ops = Array.isArray(op) ? op : [op as Op];
		this.#runtime.batch(() => {
			for (const o of ops) this.#runtime.commit(o);
		});
	}

	batch(f: () => void): void {
		this.#runtime.batch(f);
	}

	onApply(f: (op: Op) => void): () => void {
		return this.#runtime.onApply(f);
	}

	ops(): readonly Op[] {
		return this.#runtime.log.ops();
	}

	snapshot(): Json {
		return this.#runtime.snapshot([]);
	}

	explain(): never {
		return later("session.explain");
	}
}

/**
 * What a session's handles share: the log, the engine, the listeners, the
 * cached handles and the batching. Not public: the session and the handles
 * are its only users.
 */
export class Runtime {
	readonly log: Log;
	readonly engine: Engine;
	readonly #listeners = new Map<string, Set<() => void>>();
	readonly #applyListeners = new Set<(op: Op) => void>();
	readonly #handles = new Map<string, unknown>();
	/** The ops applied since subscribers were last told. */
	#pending: Op[] = [];
	/** How many batches are open. */
	#depth = 0;

	constructor(
		readonly plan: Plan,
		replica: string,
		saved: readonly Op[],
	) {
		this.log = new OpLog(plan, replica);
		this.engine = new CellEngine(plan, this.log);
		for (const op of saved) {
			const r = this.log.apply(op);
			if (r.ok) this.engine.invalidate(r.value);
		}
	}

	/** Applies an op and, outside a batch, notifies subscribers and `onApply`. */
	commit(op: Op): Result<Op> {
		const r = this.log.apply(op);
		if (!r.ok) return r;
		this.engine.invalidate(r.value);
		this.#pending.push(op);
		if (this.#depth === 0) this.#flush();
		return { ok: true, value: op };
	}

	/** Makes the op for this process's intent and commits it. */
	local(intent: Intent): Result<Op> {
		const op = this.log.local(intent);
		return op.ok ? this.commit(op.value) : op;
	}

	/** Runs `f`, and notifies once after the outermost batch. */
	batch(f: () => void): void {
		this.#depth++;
		try {
			f();
		} finally {
			this.#depth--;
		}
		if (this.#depth === 0) this.#flush();
	}

	onApply(f: (op: Op) => void): () => void {
		this.#applyListeners.add(f);
		return () => this.#applyListeners.delete(f);
	}

	/** Calls `listener` whenever the value at `at` changes. Returns the unsubscribe. */
	subscribe(at: Address, listener: () => void): () => void {
		const k = key(at);
		let set = this.#listeners.get(k);
		if (!set) {
			set = new Set();
			this.#listeners.set(k, set);
			this.engine.watch(at);
		}
		const own = () => listener();
		set.add(own);
		return () => {
			set.delete(own);
			if (set.size === 0) {
				this.#listeners.delete(k);
				this.engine.unwatch(at);
			}
		};
	}

	entity(at: Address): LiveEntity {
		return this.#cached("entity", at, () => new LiveEntity(this, at));
	}

	member(at: Address): LiveMember {
		return this.#cached("member", at, () => new LiveMember(this, at));
	}

	choice(at: Address): LiveChoice {
		return this.#cached("choice", at, () => new LiveChoice(this, at));
	}

	trait(at: Address, trait: string): LiveTrait {
		return this.#cached(
			`as:${trait}`,
			at,
			() => new LiveTrait(this, at, trait),
		);
	}

	/** The entity at `at`; for a trait-typed input, the one it holds now. */
	instance(at: Address): LiveEntity {
		const resolved = [...at];
		while (this.collection(resolved) === "choice") {
			resolved.push(this.members(resolved)[0] as string);
		}
		return this.entity(resolved);
	}

	list(at: Address): LiveList {
		return this.#cached("list", at, () => new LiveList(this, at));
	}

	map(at: Address): LiveMap {
		return this.#cached("map", at, () => new LiveMap(this, at));
	}

	/** Whether the address names a list, a map or a trait-typed input, and which. */
	collection(at: Address): "list" | "map" | "choice" | undefined {
		const found = locate(this.plan, at);
		if (found?.kind === "placed") return found.placed.kind;
		if (found?.kind === "input" && found.input.kind !== "value") {
			return found.input.kind;
		}
		return undefined;
	}

	/** A collection's element ids, or a map's keys, in order: placed by the program, or added by ops. */
	members(at: Address): readonly string[] {
		const found = locate(this.plan, at);
		if (found?.kind === "placed") return found.placed.elements.map((e) => e.id);
		return this.log.members(at);
	}

	/** The values of the enum the input at `at` takes, in order; none for any other member. */
	options(at: Address): readonly EnumOption[] {
		const found = locate(this.plan, at);
		if (found?.kind !== "input" || found.input.kind !== "value") return [];
		const { values = [], meta = {} } = found.input.type;
		return values.map((value) =>
			meta[value] === undefined ? { value } : { value, meta: meta[value] },
		);
	}

	/**
	 * Why the Operator can't set a Builder's enum to `v`: it isn't one of
	 * its values now. Ops replayed from before the Builder removed it are kept.
	 */
	outside(at: Address, v: Json): Result<never> | undefined {
		const found = locate(this.plan, at);
		if (found?.kind !== "input" || found.input.kind !== "value") return;
		const { open, values } = found.input.type;
		if (open && typeof v === "string" && !values?.includes(v)) {
			return fail("op.type", `"${v}" isn't one of the values`, at);
		}
		return undefined;
	}

	/** The checks on the value at `at`, from its type. */
	check(at: Address): Check | undefined {
		const found = locate(this.plan, at);
		if (found?.kind === "value") return found.value.check;
		if (found?.kind === "input" && found.input.kind === "value") {
			return found.input.check;
		}
		return undefined;
	}

	/**
	 * The issues of every value in the instance at `at`, and in every
	 * instance it holds, in the order of `snapshot`.
	 */
	issuesIn(at: Address): Issue[] {
		const found = locate(this.plan, at);
		if (found?.kind !== "instance") return [];
		const { inputs, values, placed, traits } = found.shape;
		const out: Issue[] = [];
		for (const name of [...Object.keys(inputs), ...Object.keys(placed)]) {
			const m = [...at, name];
			const kind = this.collection(m);
			if (kind === "choice") out.push(...this.instance(m).issues());
			else if (kind === "list" || kind === "map") {
				for (const id of this.members(m)) {
					out.push(...this.entity([...m, id]).issues());
				}
			} else if (placed[name]) out.push(...this.entity(m).issues());
			else out.push(...this.member(m).issues());
		}
		for (const name of Object.keys(values)) {
			out.push(...this.member([...at, name]).issues());
		}
		for (const [trait, plan] of Object.entries(traits)) {
			for (const name of Object.keys(plan.values)) {
				out.push(...this.member([...at, traitSegment(trait), name]).issues());
			}
		}
		return out;
	}

	/** An address as a path `session.at` takes: a list element by `{ id }`, through a trait-typed input to what it holds. */
	path(at: Address): Path {
		const out: Path[number][] = [];
		at.forEach((segment, i) => {
			const kind = this.collection(at.slice(0, i));
			if (kind !== "choice")
				out.push(kind === "list" ? { id: segment } : segment);
		});
		return out;
	}

	/** The address of the entity that holds the one at `at`. */
	parent(at: Address): Address | undefined {
		return parentOf(this.plan, at);
	}

	/**
	 * A path with positions and `{ id }` segments, from the instance at
	 * `from`, as an address of element ids. `lists` collects the lists it
	 * passes through.
	 */
	address(
		path: Path,
		from: Address = [],
		lists: Address[] = [],
	): Address | undefined {
		const at: string[] = [...from];
		// A trait-typed input reads as the instance it holds now.
		const through = () => {
			while (this.collection(at) === "choice") {
				lists.push([...at]);
				at.push(this.members(at)[0] as string);
			}
		};
		for (const segment of path) {
			through();
			if (this.collection(at)) {
				lists.push([...at]);
				const ids = this.members(at);
				const id =
					typeof segment === "number"
						? ids[segment < 0 ? ids.length + segment : segment]
						: typeof segment === "object"
							? segment.id
							: segment;
				if (id === undefined || !ids.includes(id)) return undefined;
				at.push(id);
			} else if (typeof segment === "string") at.push(segment);
			else return undefined;
		}
		through();
		return at;
	}

	/**
	 * Calls `listener` when what `path` names from `from` changes: its value,
	 * or which element a position names. Unlike a handle, which keeps to the
	 * element it was found at, this follows the position: after the first row
	 * is removed, `["rows", 0, "amount"]` is the new first row's amount.
	 */
	subscribePath(from: Address, path: Path, listener: () => void): () => void {
		let stops: (() => void)[] = [];
		let watching = "";
		let last: { at: string; value: Result<unknown> | undefined } | undefined;

		const check = (): void => {
			const lists: Address[] = [];
			const at = this.address(path, from, lists);
			const found = at && locate(this.plan, at);
			const isValue =
				found?.kind === "value" ||
				found?.kind === "placed" ||
				found?.kind === "input";
			// Watch the collections the path passes through, and the value or collection it ends at.
			const watch = [...lists, ...(at && isValue ? [at] : [])];
			if (JSON.stringify(watch) !== watching) {
				for (const stop of stops) stop();
				stops = watch.map((w) => this.subscribe(w, check));
				watching = JSON.stringify(watch);
			}
			const now = {
				at: at ? key(at) : "",
				value: at && isValue ? this.engine.read(at) : undefined,
			};
			const changed =
				last !== undefined &&
				(now.at !== last.at ||
					(now.value && last.value
						? !same(now.value, last.value)
						: now.value !== last.value));
			last = now;
			if (changed) listener();
		};

		check();
		return () => {
			for (const stop of stops) stop();
			stops = [];
		};
	}

	/**
	 * Every value of the instance at `at`, as JSON. A list is an array of its
	 * elements, each with its `id`; a map is an object keyed by its keys.
	 */
	snapshot(at: Address): Json {
		const found = locate(this.plan, at);
		if (found?.kind !== "instance") return null;
		const out: Record<string, Json> = {};
		const { inputs, values, placed } = found.shape;
		for (const name of [...Object.keys(inputs), ...Object.keys(placed)]) {
			const m = [...at, name];
			const kind = this.collection(m);
			if (kind === "choice") {
				const type = this.members(m)[0] as string;
				out[name] = { type, ...(this.snapshot([...m, type]) as object) };
			} else if (kind === "list") {
				out[name] = this.members(m).map((id) => ({
					id,
					...(this.snapshot([...m, id]) as object),
				}));
			} else if (kind === "map") {
				out[name] = Object.fromEntries(
					this.members(m).map((id) => [id, this.snapshot([...m, id])]),
				);
			} else if (placed[name]) out[name] = this.snapshot(m);
			else out[name] = json(this.engine.read(m));
		}
		for (const name of Object.keys(values)) {
			out[name] = json(this.engine.read([...at, name]));
		}
		return out;
	}

	#flush(): void {
		const changed = this.engine.settle();
		for (const at of changed) {
			for (const listener of [...(this.#listeners.get(key(at)) ?? [])]) {
				listener();
			}
		}
		const ops = this.#pending;
		this.#pending = [];
		for (const op of ops) for (const f of [...this.#applyListeners]) f(op);
	}

	#cached<T>(kind: string, at: Address, make: () => T): T {
		const k = `${kind}${key(at)}`;
		let h = this.#handles.get(k) as T | undefined;
		if (h === undefined) {
			h = make();
			this.#handles.set(k, h);
		}
		return h;
	}
}

/** A value as JSON for a snapshot: decimals as strings, errors by code. */
function json(r: Result<unknown>): Json {
	if (!r.ok) return { $error: r.error.code };
	return JSON.parse(JSON.stringify(r.value ?? null)) as Json;
}

/** A path to the program's own parts as an address: a list position the Builder placed is its id. */
function staticAddress(path: Path): Address {
	return path.map((s) => (typeof s === "object" ? s.id : String(s)));
}

function startsWith(path: ReadPath, prefix: Address): boolean {
	return (
		path.length >= prefix.length &&
		prefix.every((s, i) => String(path[i]) === s)
	);
}

function unique(paths: readonly ReadPath[]): ReadPath[] {
	const seen = new Set<string>();
	return paths.filter((p) => {
		const k = JSON.stringify(p);
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
}

function randomReplica(): string {
	return Math.random().toString(36).slice(2, 10);
}

function key(at: Address): string {
	return JSON.stringify(at);
}
