import type { Address, InputPlan, Plan, Shape, ValueTypePlan } from "../plan";
import { Decimal, fail, type Json, type Result } from "../values";
import { keyBetween } from "./order";
import type { Change, Log, Op } from "./types";

interface Clock {
	readonly replica: string;
	readonly counter: number;
}
interface Stored {
	readonly value: unknown;
	readonly cleared: boolean;
	readonly clock: Clock;
}
interface Element {
	order: string;
	clock: Clock;
}

/** Creates an empty log over a plan, for one replica. */
export function createLog(plan: Plan, replica: string): Log {
	if (replica.includes(":"))
		throw new Error(`thence: a replica id can't contain ":"`);
	let counter = 0;
	const applied: Op[] = [];
	const stored = new Map<string, Stored>();
	const lists = new Map<string, Map<string, Element>>();
	const removed = new Set<string>();

	type Found =
		| { kind: "value"; input: Extract<InputPlan, { kind: "value" }> }
		| { kind: "list"; shape: string }
		| { kind: "element"; list: Address; id: string; removed: boolean };

	/** Follows an address through the plan. */
	const walk = (at: Address): Result<Found> => {
		let shape: Shape | undefined = plan.shapes.get(plan.root);
		for (let i = 0; i < at.length; i++) {
			const name = at[i] as string;
			const input = shape?.inputs[name];
			if (!input) return fail("op.path", `no input "${name}"`, at);
			if (input.kind === "value") {
				return i === at.length - 1
					? { ok: true, value: { kind: "value", input } }
					: fail("op.path", `"${name}" holds a value, not an entity`, at);
			}
			if (i === at.length - 1) {
				return { ok: true, value: { kind: "list", shape: input.of } };
			}
			const list = at.slice(0, i + 1);
			const id = at[i + 1] as string;
			const elementKey = key([...list, id]);
			if (!lists.get(key(list))?.has(id)) {
				return fail("op.element", `no element "${id}" in "${name}"`, at);
			}
			if (removed.has(elementKey) || i + 1 === at.length - 1) {
				return {
					ok: true,
					value: {
						kind: "element",
						list,
						id,
						removed: removed.has(elementKey),
					},
				};
			}
			shape = plan.shapes.get(input.of);
			i++;
		}
		return fail("op.path", "an op needs an address", at);
	};

	const initial = (input: Extract<InputPlan, { kind: "value" }>): unknown => {
		const decoded = decode(input.type, input.initial, []);
		return decoded.ok ? decoded.value : null;
	};

	const ordered = (list: Address): [string, Element][] =>
		[...(lists.get(key(list)) ?? [])]
			.filter(([id]) => !removed.has(key([...list, id])))
			.sort(([ia, a], [ib, b]) =>
				a.order < b.order ? -1 : a.order > b.order ? 1 : ia < ib ? -1 : 1,
			);

	/** The order key for a new position `index` in a list, or the end. */
	const orderAt = (
		list: Address,
		index: number | undefined,
		moving?: string,
	) => {
		const others = ordered(list).filter(([id]) => id !== moving);
		const i = Math.max(0, Math.min(index ?? others.length, others.length));
		return keyBetween(others[i - 1]?.[1].order, others[i]?.[1].order);
	};

	const tick = (): Clock => ({ replica, counter: ++counter });

	const log: Log = {
		replica,

		apply(op) {
			if (op.clock === undefined)
				return fail("op.clock", "an op needs a clock", op.at);
			const clock = parseClock(op.clock);
			if (!clock) return fail("op.clock", `"${op.clock}" isn't a clock`, op.at);
			const found = walk(op.at);
			if (!found.ok) return found;
			const where = found.value;
			counter = Math.max(counter, clock.counter);
			let changes: Change[] = [];

			if (where.kind === "element" && where.removed) {
				// Removal wins: anything inside a removed element is dropped.
				changes = [];
			} else if (op.t === "set" || op.t === "clear") {
				if (where.kind !== "value")
					return fail("op.path", "only a value can be set", op.at);
				let value: unknown;
				if (op.t === "set") {
					const decoded = decode(where.input.type, op.v, op.at);
					if (!decoded.ok) return decoded;
					value = decoded.value;
				}
				const k = key(op.at);
				const before = stored.get(k);
				if (!before || later(clock, before.clock)) {
					stored.set(k, {
						value: op.t === "set" ? value : initial(where.input),
						cleared: op.t === "clear",
						clock,
					});
					changes = [{ kind: "input", at: op.at }];
				}
			} else if (op.t === "add") {
				if (where.kind !== "list")
					return fail("op.path", "only a list can be added to", op.at);
				const id = op.id ?? op.clock;
				const k = key(op.at);
				const elements = lists.get(k) ?? new Map<string, Element>();
				lists.set(k, elements);
				if (!elements.has(id)) {
					elements.set(id, { order: op.order, clock });
					changes = [{ kind: "members", at: op.at }];
				}
			} else if (op.t === "move" || op.t === "remove") {
				if (where.kind !== "element") {
					return fail("op.path", `only an element can be ${op.t}d`, op.at);
				}
				const element = lists.get(key(where.list))?.get(where.id) as Element;
				if (op.t === "remove") {
					removed.add(key(op.at));
					changes = [{ kind: "members", at: where.list }];
				} else if (later(clock, element.clock)) {
					element.order = op.order;
					element.clock = clock;
					changes = [{ kind: "members", at: where.list }];
				}
			}
			applied.push(op);
			return { ok: true, value: changes };
		},

		local(intent) {
			const found = walk(intent.at);
			if (!found.ok) return found;
			const clock = tick();
			const c = `${clock.replica}:${clock.counter}`;
			switch (intent.t) {
				case "set":
					return {
						ok: true,
						value: { t: "set", at: intent.at, v: toJson(intent.v), clock: c },
					};
				case "clear":
					return { ok: true, value: { t: "clear", at: intent.at, clock: c } };
				case "add":
					return {
						ok: true,
						value: {
							t: "add",
							at: intent.at,
							id: c,
							order: orderAt(intent.at, intent.index),
							clock: c,
						},
					};
				case "move": {
					const list = intent.at.slice(0, -1);
					const id = intent.at[intent.at.length - 1] as string;
					return {
						ok: true,
						value: {
							t: "move",
							at: intent.at,
							order: orderAt(list, intent.index, id),
							clock: c,
						},
					};
				}
				case "remove":
					return { ok: true, value: { t: "remove", at: intent.at, clock: c } };
			}
		},

		input(at) {
			const s = stored.get(key(at));
			if (s) return s.value;
			const found = walk(at);
			return found.ok && found.value.kind === "value"
				? initial(found.value.input)
				: null;
		},

		isSet(at) {
			const s = stored.get(key(at));
			return s !== undefined && !s.cleared;
		},

		members: (at) => ordered(at).map(([id]) => id),

		ops: () => applied,
	};
	return log;
}

/** Turns an op's JSON into the value a member holds, or rejects it. */
function decode(type: ValueTypePlan, v: Json, at: Address): Result<unknown> {
	if (v === null) {
		return type.nullable
			? { ok: true, value: null }
			: fail("op.type", "this value can't be empty", at);
	}
	switch (type.base) {
		case "number":
			if (typeof v === "number" && Number.isFinite(v))
				return { ok: true, value: v };
			break;
		case "int":
			if (Number.isSafeInteger(v)) return { ok: true, value: v };
			break;
		case "decimal": {
			const d =
				typeof v === "string"
					? Decimal.parse(v, type.scale ?? 0)
					: typeof v === "number"
						? Decimal.from(v, type.scale ?? 0)
						: undefined;
			if (d) return { ok: true, value: d };
			break;
		}
		case "text":
		case "date":
			if (typeof v === "string") return { ok: true, value: v };
			break;
		case "bool":
			if (typeof v === "boolean") return { ok: true, value: v };
			break;
		case "enum":
			if (typeof v === "string" && (type.values?.includes(v) ?? true)) {
				return { ok: true, value: v };
			}
			break;
		case "json":
			return { ok: true, value: v };
	}
	return fail("op.type", `${JSON.stringify(v)} isn't a ${type.base}`, at);
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

function key(at: Address): string {
	return JSON.stringify(at);
}

function toJson(value: unknown): Json {
	return JSON.parse(JSON.stringify(value ?? null)) as Json;
}
