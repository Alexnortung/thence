import { describe, expect, it } from "vitest";
import type { Plan } from "../plan";
import type { Json } from "../values";
import { keyBetween, type Op, OpLog } from ".";

const plan: Plan = {
	root: "root",
	shapes: new Map([
		[
			"root",
			{
				id: "root",
				entity: "quote",
				inputs: {
					qty: {
						kind: "value",
						type: { base: "int", nullable: false },
						initial: 1,
					},
					note: {
						kind: "value",
						type: { base: "text", nullable: true },
						initial: null,
					},
					price: {
						kind: "value",
						type: { base: "decimal", nullable: false, scale: 2 },
						initial: "0.00",
					},
					rows: { kind: "list", of: "row" },
					rates: { kind: "map", of: "row" },
				},
				values: {},
				placed: {},
			},
		],
		[
			"row",
			{
				id: "row",
				entity: "row",
				inputs: {
					amount: {
						kind: "value",
						type: { base: "number", nullable: false },
						initial: 0,
					},
				},
				values: {},
				placed: {},
			},
		],
	]),
};

const set = (at: string[], v: Json, clock: string): Op => ({
	t: "set",
	at,
	v,
	clock,
});

describe("log", () => {
	it("starts every input at its initial value", () => {
		const log = new OpLog(plan, "c1");
		expect(log.input(["qty"])).toBe(1);
		expect(log.input(["note"])).toBe(null);
		expect(String(log.input(["price"]))).toBe("0.00");
		expect(log.isSet(["qty"])).toBe(false);
	});

	it("reports which input an op changed", () => {
		const log = new OpLog(plan, "c1");
		expect(log.apply(set(["qty"], 3, "c2:1"))).toEqual({
			ok: true,
			value: [{ kind: "input", at: ["qty"] }],
		});
		expect(log.input(["qty"])).toBe(3);
		expect(log.isSet(["qty"])).toBe(true);
	});

	it("keeps the later set, whatever order ops arrive in", () => {
		const a = new OpLog(plan, "c1");
		const b = new OpLog(plan, "c1");
		const early = set(["qty"], 3, "c2:1");
		const late = set(["qty"], 4, "c3:2");
		a.apply(early);
		a.apply(late);
		b.apply(late);
		expect(b.apply(early)).toEqual({ ok: true, value: [] });
		expect(a.input(["qty"])).toBe(4);
		expect(b.input(["qty"])).toBe(4);
	});

	it("breaks a clock tie by replica id", () => {
		const log = new OpLog(plan, "c1");
		log.apply(set(["qty"], 3, "c9:1"));
		log.apply(set(["qty"], 4, "c1:1"));
		expect(log.input(["qty"])).toBe(3);
	});

	it("moves its own clock past every clock it has seen", () => {
		const log = new OpLog(plan, "c1");
		log.apply(set(["qty"], 3, "c2:41"));
		const op = log.local({ t: "set", at: ["qty"], v: 5 });
		expect(op.ok && op.value.clock).toBe("c1:42");
	});

	it("rejects an op that doesn't fit the plan", () => {
		const log = new OpLog(plan, "c1");
		const code = (op: Op) => {
			const r = log.apply(op);
			return r.ok ? "ok" : r.error.code;
		};
		expect(code(set(["qtty"], 3, "c1:1"))).toBe("op.path");
		expect(code(set(["qty"], 1.5, "c1:1"))).toBe("op.type");
		expect(code(set(["qty"], null, "c1:1"))).toBe("op.type");
		expect(code(set(["price"], "abc", "c1:1"))).toBe("op.type");
		expect(code({ t: "set", at: ["qty"], v: 3 })).toBe("op.clock");
		expect(code(set(["rows", "c1:9", "amount"], 3, "c1:1"))).toBe("op.element");
		expect(log.ops()).toEqual([]);
	});

	it("decodes decimals at the type's scale", () => {
		const log = new OpLog(plan, "c1");
		log.apply(set(["price"], "19.99", "c1:1"));
		expect(String(log.input(["price"]))).toBe("19.99");
	});

	it("adds list elements in order, with the add's clock as the id", () => {
		const log = new OpLog(plan, "c1");
		const add = (index?: number) => {
			const op = log.local({
				t: "add",
				at: ["rows"],
				...(index === undefined ? {} : { index }),
			});
			if (!op.ok) throw new Error(op.error.message);
			log.apply(op.value);
			return op.value;
		};
		add();
		add();
		add(0);
		expect(log.members(["rows"])).toEqual(["c1:3", "c1:1", "c1:2"]);
	});

	it("moves and removes elements", () => {
		const log = new OpLog(plan, "c1");
		for (let i = 0; i < 3; i++) {
			const op = log.local({ t: "add", at: ["rows"] });
			if (op.ok) log.apply(op.value);
		}
		const move = log.local({ t: "move", at: ["rows", "c1:3"], index: 0 });
		if (move.ok) log.apply(move.value);
		expect(log.members(["rows"])).toEqual(["c1:3", "c1:1", "c1:2"]);
		log.apply({ t: "remove", at: ["rows", "c1:1"], clock: "c1:9" });
		expect(log.members(["rows"])).toEqual(["c1:3", "c1:2"]);
	});

	it("lets a removal win over a set on the removed element", () => {
		const log = new OpLog(plan, "c1");
		log.apply({
			t: "add",
			at: ["rows"],
			id: "c1:1",
			order: "V",
			clock: "c1:1",
		});
		log.apply({ t: "remove", at: ["rows", "c1:1"], clock: "c2:2" });
		expect(log.apply(set(["rows", "c1:1", "amount"], 5, "c3:3"))).toEqual({
			ok: true,
			value: [],
		});
	});
});

describe("maps", () => {
	const add = (key: string, clock: string): Op => ({
		t: "add",
		at: ["rates"],
		key,
		order: "V",
		clock,
	});
	const remove = (key: string, clock: string): Op => ({
		t: "remove",
		at: ["rates", key],
		clock,
	});
	const amount = (key: string) => ["rates", key, "amount"];

	it("makes one element of two adds of the same key", () => {
		const log = new OpLog(plan, "c1");
		log.apply(add("SE", "c1:1"));
		log.apply(add("SE", "c2:1"));
		log.apply(set(amount("SE"), 5, "c2:2"));
		expect(log.members(["rates"])).toEqual(["SE"]);
		expect(log.input(amount("SE"))).toBe(5);
	});

	it("starts a key added again afresh, whatever order the ops arrive in", () => {
		const ops = [
			add("SE", "c1:1"),
			set(amount("SE"), 5, "c1:2"),
			remove("SE", "c1:3"),
			set(amount("SE"), 6, "c2:3"), // made before c2 saw the removal: lost
			add("SE", "c1:4"),
		];
		for (const order of [
			ops,
			[...ops].reverse(),
			[ops[0], ...ops.slice(2), ops[1]],
		]) {
			const log = new OpLog(plan, "c9");
			for (const op of order as Op[]) log.apply(op);
			expect(log.members(["rates"])).toEqual(["SE"]);
			expect(log.input(amount("SE"))).toBe(0);
			expect(log.isSet(amount("SE"))).toBe(false);
		}
	});

	it("needs a key to add, and a new one for a local add", () => {
		const log = new OpLog(plan, "c1");
		const r = log.apply({ t: "add", at: ["rates"], order: "V", clock: "c1:1" });
		expect(!r.ok && r.error.code).toBe("op.key");
		const op = log.local({ t: "add", at: ["rates"], key: "NO" });
		if (op.ok) log.apply(op.value);
		const again = log.local({ t: "add", at: ["rates"], key: "NO" });
		expect(!again.ok && again.error.code).toBe("op.key");
	});
});

describe("keyBetween", () => {
	it("makes keys that sort between their neighbours", () => {
		let keys = [keyBetween(undefined, undefined)];
		for (let i = 0; i < 50; i++) {
			const at = i % (keys.length + 1);
			keys = [
				...keys.slice(0, at),
				keyBetween(keys[at - 1], keys[at]),
				...keys.slice(at),
			];
		}
		expect([...keys].sort()).toEqual(keys);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
