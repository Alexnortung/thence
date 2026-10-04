import { same } from "../engine";
import type { AnyTrait } from "../kit";
import type { Op } from "../log";
import { type Address, locate, type Shape, traitSegment } from "../plan";
import { type Json, ok, type Path, type Result } from "../values";
import type { Has } from "./handles";
import type { Runtime } from "./runtime";
import type { Issue } from "./session";

const NONE: readonly Issue[] = Object.freeze([]);

/** A handle to an entity instance, as `session.root` and `list.at(i)` give it. */
export class LiveEntity {
	readonly type: string;
	readonly id: string;
	readonly meta: Json | undefined;
	readonly #runtime: Runtime;
	readonly #at: Address;
	readonly #shape: Shape;
	/** The issues `issues()` returned last, kept while they stay the same. */
	#issues: readonly Issue[] = NONE;

	constructor(runtime: Runtime, at: Address) {
		const found = locate(runtime.plan, at);
		if (found?.kind !== "instance") throw new Error("thence: no entity here");
		this.#runtime = runtime;
		this.#at = at;
		this.#shape = found.shape;
		this.type = found.shape.entity;
		this.meta = found.shape.meta;
		this.id = at.length === 0 ? "$root" : (at[at.length - 1] as string);
	}

	get parent(): LiveEntity | undefined {
		const parent = this.#runtime.parent(this.#at);
		return parent && this.#runtime.entity(parent);
	}

	member(name: string): LiveMember | LiveChoice {
		const at = [...this.#at, name];
		return this.#runtime.collection(at) === "choice"
			? this.#runtime.choice(at)
			: this.#runtime.member(at);
	}

	subscribe(path: Path, listener: () => void): () => void {
		return this.#runtime.subscribePath(this.#at, path, listener);
	}

	list(name: string): LiveList {
		return this.#runtime.list([...this.#at, name]);
	}

	map(name: string): LiveMap {
		return this.#runtime.map([...this.#at, name]);
	}

	/** The entity the member holds; for a trait-typed input, the one it holds now. */
	entity(name: string): LiveEntity {
		return this.#runtime.instance([...this.#at, name]);
	}

	as(trait: AnyTrait): LiveTrait {
		if (!this.implements(trait.name)) {
			throw new Error(`thence: ${this.type} doesn't implement ${trait.name}`);
		}
		return this.#runtime.trait(this.#at, trait.name);
	}

	/** Whether the entity implements the trait with this name; what `has` asks. */
	implements(trait: string): boolean {
		return trait in this.#shape.traits;
	}

	issues(): readonly Issue[] {
		const now = this.#runtime.issuesIn(this.#at);
		const same =
			now.length === this.#issues.length &&
			now.every((issue, i) => issue === this.#issues[i]);
		if (!same) this.#issues = now;
		return this.#issues;
	}
}

/** Narrows a union of handles to those that implement the trait; see {@link Has}. */
export const has = ((h: unknown, trait: AnyTrait) =>
	h instanceof LiveEntity && h.implements(trait.name)) as Has;

/** An entity read through one of its traits, made by `handle.as(TPriced)`. */
export class LiveTrait {
	readonly #runtime: Runtime;
	readonly #at: Address;
	readonly #trait: string;
	readonly #aliases: Readonly<Record<string, Address>>;

	constructor(runtime: Runtime, at: Address, trait: string) {
		const found = locate(runtime.plan, at);
		const plan = found?.kind === "instance" && found.shape.traits[trait];
		if (!plan) throw new Error(`thence: no ${trait} here`);
		this.#runtime = runtime;
		this.#at = at;
		this.#trait = trait;
		this.#aliases = plan.aliases;
	}

	/** A member of the trait that holds a value. */
	member(name: string): LiveMember {
		return this.#runtime.member([...this.#at, traitSegment(this.#trait), name]);
	}

	/** A member of the trait that holds an entity: the entity's own member it stands for. */
	entity(name: string): LiveEntity {
		const alias = this.#aliases[name];
		if (!alias)
			throw new Error(`thence: ${this.#trait} has no entity "${name}"`);
		return this.#runtime.instance([...this.#at, ...alias]);
	}
}

/** A handle to one member: an input or a computed value. */
export class LiveMember {
	readonly #runtime: Runtime;
	readonly #at: Address;
	/** The result `get()` returned last, kept while the value stays the same. */
	#last: Result<unknown> | undefined;
	/** What the checks found with the value `get()` returned; checked again only when it changes. */
	#checked: { of: Result<unknown>; issues: readonly Issue[] } | undefined;

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

	/** An error value isn't checked: it is reported as the value itself. */
	issues(): readonly Issue[] {
		const r = this.get();
		if (this.#checked?.of !== r) {
			const check = this.#runtime.check(this.#at);
			const found = r.ok && check ? check(r.value) : [];
			const path = found.length > 0 ? this.#runtime.path(this.#at) : [];
			this.#checked = {
				of: r,
				issues:
					found.length === 0
						? NONE
						: found.map((i) => ({
								message: i.message,
								path: [...path, ...i.path],
							})),
			};
		}
		return this.#checked.issues;
	}

	set(v: unknown): Result<Op> {
		const w = this.#runtime.engine.resolveWrite(this.#at, v);
		return w.ok
			? this.#runtime.local({ t: "set", at: w.value.at, v: w.value.v })
			: w;
	}

	clear(): Op {
		return orThrow(this.#runtime.local({ t: "clear", at: this.#at }));
	}

	writable(): boolean {
		return this.#runtime.engine.writable(this.#at);
	}

	isSet(): boolean {
		return this.#runtime.log.isSet(this.#at);
	}
}

/**
 * A handle to a trait-typed input: which entity it holds, as `{ type }`,
 * and `set({ type })` to switch it.
 */
export class LiveChoice {
	readonly #runtime: Runtime;
	readonly #at: Address;
	#last: Result<{ type: string }> | undefined;

	constructor(runtime: Runtime, at: Address) {
		this.#runtime = runtime;
		this.#at = at;
	}

	get(): Result<{ type: string }> {
		const type = this.#runtime.members(this.#at)[0] as string;
		if (!this.#last?.ok || this.#last.value.type !== type) {
			this.#last = ok({ type });
		}
		return this.#last;
	}

	subscribe(listener: () => void): () => void {
		return this.#runtime.subscribe(this.#at, listener);
	}

	/** Which entity it holds is never checked; `handle.issues()` has those of the instance. */
	issues(): readonly Issue[] {
		return NONE;
	}

	/** Switches to another entity that implements the trait, which starts a fresh instance. */
	set(v: { type: string }): Result<Op> {
		return this.#runtime.local({ t: "set", at: this.#at, v: { type: v.type } });
	}

	/** Goes back to the entity it started as, with a fresh instance. */
	clear(): Op {
		return orThrow(this.#runtime.local({ t: "clear", at: this.#at }));
	}

	writable(): true {
		return true;
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
