import type { Diagnostic } from "../checker";
import { createEngine, same } from "../engine";
import { createLog, type Intent, type Op } from "../log";
import { type Address, locate, type Plan } from "../plan";
import { Decimal, type Json, type Path, type Result } from "../values";
import type { Program } from "./program";

/** Makes the program `kit.program(tree)` returns, over a checked plan. */
export function createProgram(
	plan: Plan,
	diagnostics: readonly Diagnostic[],
): Program<any> {
	return {
		diagnostics,
		run: (ops = [], options = {}) =>
			run(plan, ops, options.replica ?? randomReplica()),
		parts: () => later("program.parts"),
		dependencies: () => later("program.dependencies"),
		dependents: () => later("program.dependents"),
	};
}

function run(plan: Plan, saved: readonly Op[], replica: string): any {
	const log = createLog(plan, replica);
	const engine = createEngine(plan, log);
	const listeners = new Map<string, Set<() => void>>();
	const applyListeners = new Set<(op: Op) => void>();
	const handles = new Map<string, unknown>();
	let pending: Op[] = [];
	let depth = 0;

	const flush = () => {
		const changed = engine.settle();
		for (const at of changed) {
			for (const listener of [...(listeners.get(key(at)) ?? [])]) listener();
		}
		const ops = pending;
		pending = [];
		for (const op of ops) for (const f of [...applyListeners]) f(op);
	};

	/** Applies an op and, outside a batch, notifies subscribers and `onApply`. */
	const commit = (op: Op): Result<Op> => {
		const r = log.apply(op);
		if (!r.ok) return r;
		engine.invalidate(r.value);
		pending.push(op);
		if (depth === 0) flush();
		return { ok: true, value: op };
	};

	const local = (intent: Intent): Result<Op> => {
		const op = log.local(intent);
		return op.ok ? commit(op.value) : op;
	};

	const cached = <T>(kind: string, at: Address, make: () => T): T => {
		const k = `${kind}${key(at)}`;
		let h = handles.get(k) as T | undefined;
		if (h === undefined) {
			h = make();
			handles.set(k, h);
		}
		return h;
	};

	const entity = (at: Address): any =>
		cached("entity", at, () => {
			const found = locate(plan, at);
			if (found?.kind !== "instance") throw new Error("thence: no entity here");
			return {
				type: found.shape.entity,
				id: at.length === 0 ? "$root" : at[at.length - 1],
				meta: undefined,
				get parent() {
					return at.length === 0 ? undefined : entity(at.slice(0, -2));
				},
				member: (name: string) => member([...at, name]),
				list: (name: string) => list([...at, name]),
				as: () => later("handle.as"),
				entity: () => later("handle.entity"),
				map: () => later("handle.map"),
				issues: () => [],
			};
		});

	const member = (at: Address): any =>
		cached("member", at, () => {
			let last: Result<unknown> | undefined;
			return {
				get() {
					const r = engine.read(at);
					if (!last || !same(last, r)) last = r;
					return last;
				},
				subscribe(listener: () => void) {
					const k = key(at);
					let set = listeners.get(k);
					if (!set) {
						set = new Set();
						listeners.set(k, set);
						engine.watch(at);
					}
					const own = () => listener();
					set.add(own);
					return () => {
						set.delete(own);
						if (set.size === 0) {
							listeners.delete(k);
							engine.unwatch(at);
						}
					};
				},
				issues: () => [],
				set(v: unknown) {
					const w = engine.resolveWrite(
						at,
						v instanceof Decimal ? v.toJSON() : v,
					);
					return w.ok ? local({ t: "set", at: w.value.at, v: w.value.v }) : w;
				},
				clear() {
					const r = local({ t: "clear", at });
					if (!r.ok) throw new Error(`thence: ${r.error.message}`);
					return r.value;
				},
				writable: () => engine.resolveWrite(at, null).ok,
				isSet: () => log.isSet(at),
			};
		});

	const list = (at: Address): any =>
		cached("list", at, () => {
			const added = (r: Result<Op>) => {
				if (!r.ok) throw new Error(`thence: ${r.error.message}`);
				const op = r.value as Extract<Op, { t: "add" }>;
				return entity([...at, op.id ?? (op.clock as string)]);
			};
			const done = (r: Result<Op>) => {
				if (!r.ok) throw new Error(`thence: ${r.error.message}`);
			};
			return {
				add: () => added(local({ t: "add", at })),
				insert: (index: number) => added(local({ t: "add", at, index })),
				move: (id: string, index: number) =>
					done(local({ t: "move", at: [...at, id], index })),
				remove: (id: string) => done(local({ t: "remove", at: [...at, id] })),
				at(index: number) {
					const ids = log.members(at);
					const id = ids[index < 0 ? ids.length + index : index];
					return id === undefined ? undefined : entity([...at, id]);
				},
				entries: () => log.members(at).map((id) => [id, entity([...at, id])]),
			};
		});

	/** A path with positions and `{ id }` segments, as an address of element ids. */
	const address = (path: Path): Address | undefined => {
		const at: string[] = [];
		for (const segment of path) {
			const found = locate(plan, at);
			if (found?.kind === "input" && found.input.kind === "list") {
				const ids = log.members(at);
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
	};

	const snapshot = (at: Address): Json => {
		const found = locate(plan, at);
		if (found?.kind !== "instance") return null;
		const out: Record<string, Json> = {};
		for (const [name, input] of Object.entries(found.shape.inputs)) {
			const m = [...at, name];
			out[name] =
				input.kind === "list"
					? log
							.members(m)
							.map((id) => ({ id, ...(snapshot([...m, id]) as object) }))
					: json(engine.read(m));
		}
		for (const name of Object.keys(found.shape.values)) {
			out[name] = json(engine.read([...at, name]));
		}
		return out;
	};

	for (const op of saved) {
		const r = log.apply(op);
		if (r.ok) engine.invalidate(r.value);
	}

	return {
		root: entity([]),
		at(path: Path) {
			const at = address(path);
			const found = at && locate(plan, at);
			if (!at || !found) return undefined;
			if (found.kind === "instance") return entity(at);
			if (found.kind === "input" && found.input.kind === "list")
				return list(at);
			return member(at);
		},
		issues: () => [],
		apply(op: Op | readonly Op[]) {
			const ops = Array.isArray(op) ? op : [op as Op];
			depth++;
			try {
				for (const o of ops) commit(o);
			} finally {
				depth--;
			}
			if (depth === 0) flush();
		},
		batch(f: () => void) {
			depth++;
			try {
				f();
			} finally {
				depth--;
			}
			if (depth === 0) flush();
		},
		onApply(f: (op: Op) => void) {
			applyListeners.add(f);
			return () => applyListeners.delete(f);
		},
		ops: () => log.ops(),
		snapshot: () => snapshot([]),
		explain: () => later("session.explain"),
	};
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

function later(what: string): never {
	throw new Error(`thence: ${what} isn't implemented yet`);
}
