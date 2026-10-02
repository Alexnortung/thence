import type { Diagnostic } from "../checker";
import { CellEngine, type Engine } from "../engine";
import { type Intent, type Log, type Op, OpLog } from "../log";
import { type Address, locate, type Plan } from "../plan";
import type { Json, Path, Result } from "../values";
import { LiveEntity, LiveList, LiveMember, later } from "./live";
import type { Program, RunOptions } from "./program";
import type { Session } from "./session";

/** The program `kit.program(tree)` returns, over a checked plan. */
export class CheckedProgram implements Program<any> {
	readonly #plan: Plan;

	constructor(
		plan: Plan,
		readonly diagnostics: readonly Diagnostic[],
	) {
		this.#plan = plan;
	}

	run(ops: readonly Op[] = [], options: RunOptions = {}): Session<any> {
		return new LiveSession(
			new Runtime(this.#plan, options.replica ?? randomReplica(), ops),
		);
	}

	parts(): never {
		return later("program.parts");
	}

	dependencies(): never {
		return later("program.dependencies");
	}

	dependents(): never {
		return later("program.dependents");
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
		if (found.kind === "input" && found.input.kind === "list")
			return r.list(at);
		return r.member(at);
	}

	issues(): never[] {
		return [];
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

	list(at: Address): LiveList {
		return this.#cached("list", at, () => new LiveList(this, at));
	}

	/** A path with positions and `{ id }` segments, as an address of element ids. */
	address(path: Path): Address | undefined {
		const at: string[] = [];
		for (const segment of path) {
			const found = locate(this.plan, at);
			if (found?.kind === "input" && found.input.kind === "list") {
				const ids = this.log.members(at);
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
		return at;
	}

	/** Every value of the instance at `at`, as JSON. */
	snapshot(at: Address): Json {
		const found = locate(this.plan, at);
		if (found?.kind !== "instance") return null;
		const out: Record<string, Json> = {};
		for (const [name, input] of Object.entries(found.shape.inputs)) {
			const m = [...at, name];
			out[name] =
				input.kind === "list"
					? this.log
							.members(m)
							.map((id) => ({ id, ...(this.snapshot([...m, id]) as object) }))
					: json(this.engine.read(m));
		}
		for (const name of Object.keys(found.shape.values)) {
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

function randomReplica(): string {
	return Math.random().toString(36).slice(2, 10);
}

function key(at: Address): string {
	return JSON.stringify(at);
}
