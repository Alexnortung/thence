import {
	type Address,
	decode,
	elementShape,
	type InputPlan,
	locate,
	type Plan,
	type Shape,
} from "../plan";
import { fail, type Json, type Result } from "../values";
import { keyBetween } from "./order";
import type { Change, Intent, Log, Op } from "./types";

interface Clock {
	readonly replica: string;
	readonly counter: number;
}
interface Stored {
	readonly value: unknown;
	readonly cleared: boolean;
	readonly clock: Clock;
}
/** An element of an Operator's collection, as the adds, removes and moves on it made it. */
interface Element {
	/** Every add and remove, in clock order. */
	readonly events: { readonly clock: Clock; readonly add?: string }[];
	/** The latest move. */
	move: { readonly clock: Clock; readonly order: string } | undefined;
}
/**
 * An element's life now. A map key can be removed and added again; each
 * time it is a fresh element, which `since` tells apart.
 */
interface Life {
	readonly alive: boolean;
	/** The clock of the add that started its latest life; what was set before it belongs to an earlier one. */
	readonly since: Clock;
	readonly order: string;
}
/** What an address names, as far as ops are concerned. */
type Found =
	| { kind: "value"; input: Extract<InputPlan, { kind: "value" }> }
	| { kind: "choice"; input: Extract<InputPlan, { kind: "choice" }> }
	| {
			kind: "collection";
			collection: "list" | "map";
			input: Extract<InputPlan, { kind: "list" | "map" }>;
	  }
	| { kind: "element"; collection: Address; id: string };
/** An element of an Operator's collection that an address passes through. */
interface Within {
	readonly collection: Address;
	readonly id: string;
	/** The element is the entity a trait-typed input holds, which lives until the input switches. */
	readonly choice?: true;
}

/** A collection's live elements by order key, then id, with their keys. */
interface Order {
	readonly ids: string[];
	readonly keys: string[];
	/** Each live element's order key, to find it again. */
	readonly of: Map<string, string>;
	members: readonly string[] | undefined;
}

/** Before every clock: when a trait-typed input that was never switched started. */
const start: Clock = { replica: "", counter: 0 };

/** A log kept in memory, over a plan, for one replica. */
export class OpLog implements Log {
	readonly #plan: Plan;
	#counter = 0;
	readonly #applied: Op[] = [];
	readonly #stored = new Map<string, Stored>();
	readonly #collections = new Map<string, Map<string, Element>>();
	/**
	 * Each collection's live elements in order, with their order keys, once
	 * something asked for them. An add, remove or move puts its one element
	 * in place, so a long list is sorted once, not on every op.
	 */
	readonly #order = new Map<string, Order>();

	constructor(
		plan: Plan,
		readonly replica: string,
	) {
		if (replica.includes(":"))
			throw new Error(`thence: a replica id can't contain ":"`);
		this.#plan = plan;
	}

	apply(op: Op): Result<readonly Change[]> {
		if (op.clock === undefined)
			return fail("op.clock", "an op needs a clock", op.at);
		const clock = parseClock(op.clock);
		if (!clock) return fail("op.clock", `"${op.clock}" isn't a clock`, op.at);
		const walked = this.#walk(op.at);
		if (!walked.ok) return walked;
		const { found, within } = walked.value;
		let changes: Change[] = [];

		if ((op.t === "set" || op.t === "clear") && found.kind === "choice") {
			// Switching the entity starts a fresh instance of the new one.
			let type = found.input.initial;
			if (op.t === "set") {
				const v = op.v as { type?: unknown } | null;
				const t = typeof v === "object" && v !== null ? v.type : undefined;
				if (typeof t !== "string" || !(t in found.input.options)) {
					return fail(
						"op.type",
						`${JSON.stringify(op.v)} isn't one of ${Object.keys(found.input.options).join(", ")}`,
						op.at,
					);
				}
				type = t;
			}
			const k = key(op.at);
			const before = this.#stored.get(k);
			if (!before || later(clock, before.clock)) {
				const was = this.#current(op.at, within).type;
				this.#stored.set(k, { value: type, cleared: op.t === "clear", clock });
				changes = [
					...this.#changedWith(op.at, was),
					...this.#changedWith(op.at, type),
				];
			}
		} else if (op.t === "set" || op.t === "clear") {
			if (found.kind !== "value")
				return fail("op.path", "only a value can be set", op.at);
			let value: unknown;
			if (op.t === "set") {
				const decoded = decode(found.input.type, op.v, op.at);
				if (!decoded.ok) return decoded;
				value = decoded.value;
			}
			const k = key(op.at);
			const before = this.#stored.get(k);
			if (!before || later(clock, before.clock)) {
				this.#stored.set(k, {
					value: op.t === "set" ? value : initial(found.input),
					cleared: op.t === "clear",
					clock,
				});
				changes = [{ kind: "input", at: op.at }];
			}
		} else if (op.t === "add") {
			if (found.kind !== "collection")
				return fail("op.path", "only a list or a map can be added to", op.at);
			const id = found.collection === "map" ? op.key : (op.id ?? op.clock);
			if (id === undefined)
				return fail("op.key", "an add to a map needs a key", op.at);
			const elements = this.#elements(op.at, found.input);
			let element = elements.get(id);
			const fresh = !element;
			if (!element) {
				element = { events: [], move: undefined };
				elements.set(id, element);
			}
			if (record(element, { clock, add: op.order })) {
				this.#reorder(op.at, id);
				// A new element holds nothing yet: no op can reach inside it before it is added.
				changes = fresh
					? [{ kind: "members", at: op.at }]
					: this.#changedWith(op.at, id);
			}
		} else if (op.t === "move" || op.t === "remove") {
			if (found.kind !== "element") {
				return fail("op.path", `only an element can be ${op.t}d`, op.at);
			}
			const element = this.#collections
				.get(key(found.collection))
				?.get(found.id) as Element;
			if (op.t === "remove") {
				if (record(element, { clock })) {
					this.#reorder(found.collection, found.id);
					changes = this.#changedWith(found.collection, found.id);
				}
			} else if (!element.move || later(clock, element.move.clock)) {
				element.move = { clock, order: op.order };
				this.#reorder(found.collection, found.id);
				changes = [{ kind: "members", at: found.collection }];
			}
		}
		this.#counter = Math.max(this.#counter, clock.counter);
		this.#applied.push(op);
		// Removal wins: whatever happens inside a removed element changes nothing now.
		const inside =
			op.t === "move" || op.t === "remove" ? within.slice(0, -1) : within;
		return {
			ok: true,
			value: inside.every((w) => this.#life(w)?.alive) ? changes : [],
		};
	}

	local(intent: Intent): Result<Op> {
		const walked = this.#walk(intent.at);
		if (!walked.ok) return walked;
		const { found } = walked.value;
		const c = `${this.replica}:${++this.#counter}`;
		switch (intent.t) {
			case "set":
				return {
					ok: true,
					value: { t: "set", at: intent.at, v: toJson(intent.v), clock: c },
				};
			case "clear":
				return { ok: true, value: { t: "clear", at: intent.at, clock: c } };
			case "add": {
				if (found.kind === "collection" && found.collection === "map") {
					if (intent.key === undefined)
						return fail("op.key", "an add to a map needs a key", intent.at);
					if (this.members(intent.at).includes(intent.key)) {
						return fail(
							"op.key",
							`the map already has "${intent.key}"`,
							intent.at,
						);
					}
					return {
						ok: true,
						value: {
							t: "add",
							at: intent.at,
							key: intent.key,
							order: this.#orderAt(intent.at, intent.index),
							clock: c,
						},
					};
				}
				return {
					ok: true,
					value: {
						t: "add",
						at: intent.at,
						id: c,
						order: this.#orderAt(intent.at, intent.index),
						clock: c,
					},
				};
			}
			case "move": {
				const list = intent.at.slice(0, -1);
				const id = intent.at[intent.at.length - 1] as string;
				return {
					ok: true,
					value: {
						t: "move",
						at: intent.at,
						order: this.#orderAt(list, intent.index, id),
						clock: c,
					},
				};
			}
			case "remove":
				return { ok: true, value: { t: "remove", at: intent.at, clock: c } };
		}
	}

	input(at: Address): unknown {
		const walked = this.#walk(at);
		if (!walked.ok || walked.value.found.kind !== "value") return null;
		const s = this.#visible(at, walked.value.within);
		return s ? s.value : initial(walked.value.found.input);
	}

	isSet(at: Address): boolean {
		const walked = this.#walk(at);
		if (!walked.ok) return false;
		const s = this.#visible(at, walked.value.within);
		return s !== undefined && !s.cleared;
	}

	members(at: Address): readonly string[] {
		const walked = this.#walk(at);
		if (walked.ok && walked.value.found.kind === "choice") {
			return [this.#current(at, walked.value.within).type];
		}
		if (!walked.ok || walked.value.found.kind !== "collection") return [];
		const order = this.#ordered(at, walked.value.found.input);
		// Handed out as a copy, kept until the next change, so a reader keeps what it read.
		order.members ??= [...order.ids];
		return order.members;
	}

	/** A collection's live elements and their order keys, sorted by order key, then id. */
	#ordered(
		at: Address,
		input: Extract<InputPlan, { kind: "list" | "map" }>,
	): Order {
		const k = key(at);
		const cached = this.#order.get(k);
		if (cached) return cached;
		const elements = this.#elements(at, input);
		const alive: [string, string][] = [];
		for (const id of elements.keys()) {
			const life = this.#life({ collection: at, id });
			if (life?.alive) alive.push([id, life.order]);
		}
		alive.sort(([ia, a], [ib, b]) => compare(a, ia, b, ib));
		const ordered: Order = {
			ids: alive.map(([id]) => id),
			keys: alive.map(([, order]) => order),
			of: new Map(alive),
			members: undefined,
		};
		this.#order.set(k, ordered);
		return ordered;
	}

	/** Puts one element where its life now says, in a collection's kept order. */
	#reorder(collection: Address, id: string): void {
		const k = key(collection);
		const cached = this.#order.get(k);
		if (!cached) return;
		const { ids, keys, of } = cached;
		cached.members = undefined;
		const was = of.get(id);
		if (was !== undefined) {
			const i = position(cached, was, id);
			ids.splice(i, 1);
			keys.splice(i, 1);
			of.delete(id);
		}
		const life = this.#life({ collection, id });
		if (life?.alive) {
			const i = position(cached, life.order, id);
			ids.splice(i, 0, id);
			keys.splice(i, 0, life.order);
			of.set(id, life.order);
		}
	}

	ops(): readonly Op[] {
		return this.#applied;
	}

	/**
	 * Follows an address through the plan, the elements the program placed,
	 * and the elements ops added, noting each added element it passes.
	 */
	#walk(at: Address): Result<{ found: Found; within: Within[] }> {
		let shape: Shape | undefined = this.#plan.shapes.get(this.#plan.root);
		const within: Within[] = [];
		for (let i = 0; i < at.length; i++) {
			if (!shape) break;
			const name = at[i] as string;
			const last = i === at.length - 1;
			const placed = shape.placed[name];
			if (placed) {
				if (placed.kind === "derived") {
					// Computed from its source: an op goes to the source's element.
					return fail(
						"op.path",
						`"${name}" is computed with map or filter, so it takes no ops`,
						at,
					);
				}
				if (last) return fail("op.path", `"${name}" isn't an input`, at);
				if (placed.kind === "entity") {
					shape = this.#plan.shapes.get(placed.shape);
					continue;
				}
				const id = at[i + 1] as string;
				const element = placed.elements.find((e) => e.id === id);
				if (!element)
					return fail("op.element", `no element "${id}" in "${name}"`, at);
				if (i + 1 === at.length - 1)
					return fail("op.path", `"${id}" isn't an input`, at);
				shape = this.#plan.shapes.get(element.shape);
				i++;
				continue;
			}
			const input = shape.inputs[name];
			if (!input) return fail("op.path", `no input "${name}"`, at);
			if (input.kind === "choice") {
				if (last) {
					return {
						ok: true,
						value: { found: { kind: "choice", input }, within },
					};
				}
				const id = at[i + 1] as string;
				const option = input.options[id];
				if (option === undefined || i + 1 === at.length - 1) {
					return fail("op.path", `"${id}" isn't an input of "${name}"`, at);
				}
				within.push({ collection: at.slice(0, i + 1), id, choice: true });
				shape = this.#plan.shapes.get(option);
				i++;
				continue;
			}
			if (input.kind === "value") {
				return last
					? { ok: true, value: { found: { kind: "value", input }, within } }
					: fail("op.path", `"${name}" holds a value, not an entity`, at);
			}
			if (last) {
				return {
					ok: true,
					value: {
						found: { kind: "collection", collection: input.kind, input },
						within,
					},
				};
			}
			const collection = at.slice(0, i + 1);
			const id = at[i + 1] as string;
			if (!this.#elements(collection, input).has(id)) {
				return fail("op.element", `no element "${id}" in "${name}"`, at);
			}
			within.push({ collection, id });
			if (i + 1 === at.length - 1) {
				return {
					ok: true,
					value: { found: { kind: "element", collection, id }, within },
				};
			}
			shape = this.#plan.shapes.get(elementShape(input, id));
			i++;
		}
		return fail("op.path", "an op needs an address", at);
	}

	/**
	 * A collection's elements. Those the Builder started it with were added
	 * before any op, in order, so the Operator can move and remove them too.
	 */
	#elements(
		collection: Address,
		input: Extract<InputPlan, { kind: "list" | "map" }>,
	): Map<string, Element> {
		const k = key(collection);
		let elements = this.#collections.get(k);
		if (!elements) {
			elements = new Map();
			let order: string | undefined;
			for (const { id } of input.initial ?? []) {
				order = keyBetween(order, undefined);
				elements.set(id, {
					events: [{ clock: start, add: order }],
					move: undefined,
				});
			}
			this.#collections.set(k, elements);
		}
		return elements;
	}

	/** An element's life now, worked out from every add and remove it has seen. */
	#life({ collection, id, choice }: Within): Life | undefined {
		if (choice) {
			const walked = this.#walk(collection);
			if (!walked.ok) return undefined;
			const now = this.#current(collection, walked.value.within);
			return { alive: now.type === id, since: now.since, order: "" };
		}
		const element = this.#collections.get(key(collection))?.get(id);
		if (!element) return undefined;
		let alive = false;
		let since: Clock | undefined;
		let order = "";
		for (const event of element.events) {
			if (event.add !== undefined && !alive) {
				alive = true;
				since = event.clock;
				order = event.add;
			} else if (event.add === undefined) alive = false;
		}
		if (!since) return undefined;
		if (element.move && later(element.move.clock, since)) {
			order = element.move.order;
		}
		return { alive, since, order };
	}

	/** The entity a trait-typed input holds now, and the clock of the switch that started it. */
	#current(
		at: Address,
		within: readonly Within[],
	): { type: string; since: Clock } {
		const s = this.#visible(at, within);
		if (s) return { type: s.value as string, since: s.clock };
		const found = locate(this.#plan, at);
		const initial =
			found?.kind === "input" && found.input.kind === "choice"
				? found.input.initial
				: "";
		return { type: initial, since: start };
	}

	/** The stored value at `at`, unless it was set before the element that holds it last came to life. */
	#visible(at: Address, within: readonly Within[]): Stored | undefined {
		const s = this.#stored.get(key(at));
		if (!s) return undefined;
		for (const w of within) {
			const life = this.#life(w);
			if (!life || !later(s.clock, life.since)) return undefined;
		}
		return s;
	}

	/**
	 * What an element coming or going changes: the collection's members, and
	 * any value or collection inside it, which may now read differently.
	 */
	#changedWith(collection: Address, id: string): Change[] {
		const changes: Change[] = [{ kind: "members", at: collection }];
		const prefix = key([...collection, id]).slice(0, -1);
		for (const k of this.#stored.keys()) {
			if (k.startsWith(`${prefix},`)) {
				changes.push({ kind: "input", at: JSON.parse(k) as string[] });
			}
		}
		for (const k of this.#collections.keys()) {
			if (k.startsWith(`${prefix},`)) {
				changes.push({ kind: "members", at: JSON.parse(k) as string[] });
			}
		}
		return changes;
	}

	/** The order key for a new position `index` in a list, or the end. */
	#orderAt(list: Address, index: number | undefined, moving?: string): string {
		const walked = this.#walk(list);
		if (!walked.ok || walked.value.found.kind !== "collection") {
			return keyBetween(undefined, undefined);
		}
		const { ids, keys } = this.#ordered(list, walked.value.found.input);
		const others =
			moving === undefined ? keys : keys.filter((_, j) => ids[j] !== moving);
		const i = Math.max(0, Math.min(index ?? others.length, others.length));
		return keyBetween(others[i - 1], others[i]);
	}
}

/**
 * Records an add or a remove on an element, in clock order. Returns false
 * for one it has seen already.
 */
function record(
	element: Element,
	event: { readonly clock: Clock; readonly add?: string },
): boolean {
	const events = element.events as { clock: Clock; add?: string }[];
	if (events.some((e) => same(e.clock, event.clock))) return false;
	let i = events.length;
	while (i > 0 && later(events[i - 1]?.clock as Clock, event.clock)) i--;
	events.splice(i, 0, event);
	return true;
}

/** Where an element with this order key and id goes, or is, in a kept order. */
function position(order: Order, key: string, id: string): number {
	const { ids, keys } = order;
	let lo = 0;
	let hi = ids.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (compare(keys[mid] as string, ids[mid] as string, key, id) < 0)
			lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/** Order key first, then id, so replicas that picked the same key still agree. */
function compare(a: string, ia: string, b: string, ib: string): number {
	return a < b ? -1 : a > b ? 1 : ia < ib ? -1 : ia > ib ? 1 : 0;
}

/** An input's initial value, decoded; `null` if the plan's initial doesn't fit. */
function initial(input: Extract<InputPlan, { kind: "value" }>): unknown {
	const decoded = decode(input.type, input.initial, []);
	return decoded.ok ? decoded.value : null;
}

function parseClock(clock: string): Clock | undefined {
	const i = clock.lastIndexOf(":");
	const counter = Number(clock.slice(i + 1));
	return i > 0 && Number.isSafeInteger(counter) && counter > 0
		? { replica: clock.slice(0, i), counter }
		: undefined;
}

/** Lamport order: the higher counter is later; on a tie, the higher replica id. */
function later(a: Clock, b: Clock): boolean {
	return a.counter !== b.counter
		? a.counter > b.counter
		: a.replica > b.replica;
}

function same(a: Clock, b: Clock): boolean {
	return a.counter === b.counter && a.replica === b.replica;
}

function key(at: Address): string {
	return JSON.stringify(at);
}

function toJson(value: unknown): Json {
	return JSON.parse(JSON.stringify(value ?? null)) as Json;
}
