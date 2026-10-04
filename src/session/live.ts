import { same } from "../engine";
import type { Op } from "../log";
import { type Address, locate } from "../plan";
import { Decimal, type Path, type Result } from "../values";
import type { Runtime } from "./runtime";

/** A handle to an entity instance, as `session.root` and `list.at(i)` give it. */
export class LiveEntity {
	readonly type: string;
	readonly id: string;
	readonly meta = undefined;
	readonly #runtime: Runtime;
	readonly #at: Address;

	constructor(runtime: Runtime, at: Address) {
		const found = locate(runtime.plan, at);
		if (found?.kind !== "instance") throw new Error("thence: no entity here");
		this.#runtime = runtime;
		this.#at = at;
		this.type = found.shape.entity;
		this.id = at.length === 0 ? "$root" : (at[at.length - 1] as string);
	}

	get parent(): LiveEntity | undefined {
		const parent = this.#runtime.parent(this.#at);
		return parent && this.#runtime.entity(parent);
	}

	member(name: string): LiveMember {
		return this.#runtime.member([...this.#at, name]);
	}

	subscribe(path: Path, listener: () => void): () => void {
		return this.#runtime.subscribePath(this.#at, path, listener);
	}

	at(path: Path): LiveEntity | LiveList | LiveMap | LiveMember | undefined {
		return this.#runtime.at(path, this.#at);
	}

	list(name: string): LiveList {
		return this.#runtime.list([...this.#at, name]);
	}

	map(name: string): LiveMap {
		return this.#runtime.map([...this.#at, name]);
	}

	entity(name: string): LiveEntity {
		return this.#runtime.entity([...this.#at, name]);
	}

	as(): never {
		return later("handle.as");
	}

	issues(): never[] {
		return [];
	}
}

/** A handle to one member: an input or a computed value. */
export class LiveMember {
	readonly #runtime: Runtime;
	readonly #at: Address;
	/** The result `get()` returned last, kept while the value stays the same. */
	#last: Result<unknown> | undefined;

	constructor(runtime: Runtime, at: Address) {
		this.#runtime = runtime;
		this.#at = at;
	}

	get(): Result<unknown> {
		const r = this.#runtime.engine.read(this.#at);
		if (!this.#last || !same(this.#last, r)) this.#last = r;
		return this.#last;
	}

	subscribe(listener: () => void): () => void {
		return this.#runtime.subscribe(this.#at, listener);
	}

	issues(): never[] {
		return [];
	}

	set(v: unknown): Result<Op> {
		const w = this.#runtime.engine.resolveWrite(
			this.#at,
			v instanceof Decimal ? v.toJSON() : v,
		);
		return w.ok
			? this.#runtime.local({ t: "set", at: w.value.at, v: w.value.v })
			: w;
	}

	clear(): Op {
		return orThrow(this.#runtime.local({ t: "clear", at: this.#at }));
	}

	writable(): boolean {
		return this.#runtime.engine.resolveWrite(this.#at, null).ok;
	}

	isSet(): boolean {
		return this.#runtime.log.isSet(this.#at);
	}
}

/**
 * A handle to a list of entities: one the Operator adds rows to, or one the
 * Builder placed, whose elements can only be read.
 */
export class LiveList {
	readonly #runtime: Runtime;
	readonly #at: Address;

	constructor(runtime: Runtime, at: Address) {
		this.#runtime = runtime;
		this.#at = at;
	}

	add(): LiveEntity {
		return this.#added(this.#runtime.local({ t: "add", at: this.#at }));
	}

	insert(index: number): LiveEntity {
		return this.#added(this.#runtime.local({ t: "add", at: this.#at, index }));
	}

	move(id: string, index: number): void {
		orThrow(this.#runtime.local({ t: "move", at: [...this.#at, id], index }));
	}

	remove(id: string): void {
		orThrow(this.#runtime.local({ t: "remove", at: [...this.#at, id] }));
	}

	at(index: number): LiveEntity | undefined {
		const ids = this.#runtime.members(this.#at);
		const id = ids[index < 0 ? ids.length + index : index];
		return id === undefined
			? undefined
			: this.#runtime.entity([...this.#at, id]);
	}

	entries(): [string, LiveEntity][] {
		return this.#runtime
			.members(this.#at)
			.map((id) => [id, this.#runtime.entity([...this.#at, id])]);
	}

	subscribe(listener: () => void): () => void {
		return this.#runtime.subscribe(this.#at, listener);
	}

	#added(r: Result<Op>): LiveEntity {
		const op = orThrow(r) as Extract<Op, { t: "add" }>;
		return this.#runtime.entity([...this.#at, op.id ?? (op.clock as string)]);
	}
}

/**
 * A handle to a map of entities: one the Operator adds keys to, or one the
 * Builder placed, whose elements can only be read.
 */
export class LiveMap {
	readonly #runtime: Runtime;
	readonly #at: Address;

	constructor(runtime: Runtime, at: Address) {
		this.#runtime = runtime;
		this.#at = at;
	}

	add(key: string): LiveEntity {
		orThrow(this.#runtime.local({ t: "add", at: this.#at, key }));
		return this.#runtime.entity([...this.#at, key]);
	}

	get(key: string): LiveEntity | undefined {
		return this.#runtime.members(this.#at).includes(key)
			? this.#runtime.entity([...this.#at, key])
			: undefined;
	}

	remove(key: string): void {
		orThrow(this.#runtime.local({ t: "remove", at: [...this.#at, key] }));
	}

	entries(): [string, LiveEntity][] {
		return this.#runtime
			.members(this.#at)
			.map((key) => [key, this.#runtime.entity([...this.#at, key])]);
	}

	subscribe(listener: () => void): () => void {
		return this.#runtime.subscribe(this.#at, listener);
	}
}

/** An Operator's mistake, such as removing a row that isn't there, is a bug in the app: it throws. */
function orThrow<T>(r: Result<T>): T {
	if (!r.ok) throw new Error(`thence: ${r.error.message}`);
	return r.value;
}

export function later(what: string): never {
	throw new Error(`thence: ${what} isn't implemented yet`);
}
