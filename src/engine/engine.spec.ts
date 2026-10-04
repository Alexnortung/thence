// Eviction: the engine keeps the cells a watched value reads and drops the
// rest once there are more than its budget. Values stay right either way.

import { describe, expect, it } from "vitest";
import { e, entity, kit, std, t } from "..";
import { check } from "../checker";
import { type Op, OpLog } from "../log";
import { CellEngine } from ".";

const ERow = entity("row", {
	inputs: { qty: t.number.initial(1), price: t.number.initial(2) },
	derived: { total: e.mul(e.self("qty"), e.self("price")) },
});
const EOrder = entity("order", {
	inputs: {
		rows: t.list(ERow),
		divisor: t.number.initial(0),
		extra: t.number.initial(0),
	},
	derived: {
		grandTotal: e.sum(e.each("rows", "total")),
		ratio: e.div(e.self("grandTotal"), e.self("divisor")),
		share: e.add(e.self("ratio"), e.self("extra")),
	},
});
const orders = kit({
	name: "orders",
	version: "1.0.0",
	functions: { ...std },
	root: EOrder,
	entities: [EOrder, ERow],
});

/** An engine with a budget of `budget` cells, over an order with `n` rows. */
const start = (n: number, budget: number) => {
	const { plan } = check(orders["~spec"], {});
	const log = new OpLog(plan, "a");
	const engine = new CellEngine(plan, log, budget);
	const apply = (op: Op) => {
		const r = log.apply(op);
		if (!r.ok) throw new Error(r.error.message);
		engine.invalidate(r.value);
	};
	let clock = 0;
	const ids: string[] = [];
	for (let i = 0; i < n; i++) {
		const id = `a:${++clock}`;
		apply({ t: "add", at: ["rows"], id, order: `a${i}`, clock: id });
		ids.push(id);
	}
	const set = (at: string[], v: number) =>
		apply({ t: "set", at, v, clock: `a:${++clock}` });
	const value = (at: string[]) => {
		const r = engine.read(at);
		return r.ok ? r.value : r.error.code;
	};
	return { engine, ids, set, value };
};

describe("eviction", () => {
	it("drops what no watched value reads, and computes it again when read", () => {
		const { engine, ids, set, value } = start(50, 0);
		const first = ["rows", ids[0] as string, "total"];
		engine.watch(first);
		for (const id of ids) value(["rows", id, "total"]);
		expect(engine.size).toBeGreaterThan(100);
		set(["rows", ids[1] as string, "qty"], 3);
		engine.settle();
		// The watched total and the two inputs it reads.
		expect(engine.size).toBe(3);
		expect(value(["rows", ids[1] as string, "total"])).toBe(6);
		expect(value(["grandTotal"])).toBe(104);
	});

	it("keeps watched values up to date after a sweep", () => {
		const { engine, ids, set, value } = start(20, 0);
		engine.watch(["grandTotal"]);
		value(["share"]);
		set(["rows", ids[0] as string, "qty"], 2);
		expect(engine.settle()).toEqual([["grandTotal"]]);
		set(["rows", ids[5] as string, "price"], 10);
		expect(engine.settle()).toEqual([["grandTotal"]]);
		expect(value(["grandTotal"])).toBe(4 + 10 + 18 * 2);
		// Every row's total and inputs, the list, and the sum.
		expect(engine.size).toBe(20 * 3 + 3);
	});

	it("finds a reference again that a failed compute skipped and a sweep dropped", () => {
		const { engine, set, value } = start(2, 0);
		// `ratio` fails, so `share` never reads `extra`, and the sweep drops it.
		engine.watch(["share"]);
		expect(value(["share"])).toBe("div.zero");
		set(["extra"], 1);
		engine.settle();
		set(["divisor"], 2);
		engine.settle();
		expect(value(["share"])).toBe(3);
		set(["extra"], 10);
		expect(engine.settle()).toEqual([["share"]]);
		expect(value(["share"])).toBe(12);
	});

	it("waits until the cells outnumber the budget", () => {
		const { engine, ids, set, value } = start(50, 1000);
		for (const id of ids) value(["rows", id, "total"]);
		set(["rows", ids[0] as string, "qty"], 2);
		engine.settle();
		expect(engine.size).toBe(150);
	});

	it("keeps only what 200 watched values need once everything was read", () => {
		const { engine, ids, set, value } = start(5000, 10_000);
		const shown = ids.slice(1000, 1200);
		for (const id of shown) engine.watch(["rows", id, "total"]);
		for (const id of ids) value(["rows", id, "total"]);
		expect(engine.size).toBe(5000 * 3);
		set(["rows", ids[0] as string, "qty"], 2);
		engine.settle();
		expect(engine.size).toBe(200 * 3);
	});
});
