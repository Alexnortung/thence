// Collections: lists and maps the Builder places or the Operator fills, paths into them, and aggregates.

import { describe, expect, it, vi } from "vitest";
import { e, entity, fn, kit, type Op, t } from "..";
import type { Ex, KnownN } from "../kit";

/** A Builder's formula as raw JSON. */
const raw = <V = number>(json: unknown) => json as Ex<KnownN<V>>;

const ERow = entity("row", {
	inputs: {
		qty: t.int.initial(1),
		price: t.number.nullable(),
		done: t.bool.initial(false),
	},
	derived: {
		total: e.mul(e.self("qty"), e.self("price")),
		position: e.index(),
		// a running total: sum skips the first row's missing $prev
		running: raw(["sum", ["ref", "$prev", "running"], ["ref", "total"]]),
	},
});
const ERate = entity("rate", {
	inputs: { percent: t.number.initial(0) },
	derived: { country: e.key() },
});
const EGroup = entity("group", {
	config: { bonus: t.expr(t.number).optional() },
	inputs: { rows: t.list(ERow) },
	derived: {
		// several values: sum skips the bonus when there is none
		subtotal: raw([
			"sum",
			["sum", ["ref", "rows", "$each", "total"]],
			["ref", "bonus"],
		]),
		first: raw(["ref", "rows", { at: 0 }, "total"]),
		last: raw(["ref", "rows", { at: -1 }, "total"]),
		count: raw(["count", ["ref", "rows", "$each", "price"]]),
		cheapest: raw(["min", ["ref", "rows", "$each", "price"]]),
		dearest: raw(["max", ["ref", "rows", "$each", "price"]]),
		anyDone: raw<boolean>(["any", ["ref", "rows", "$each", "done"]]),
		allDone: raw<boolean>(["all", ["ref", "rows", "$each", "done"]]),
	},
});
const EQuote = entity("quote", {
	config: { groups: t.map(EGroup), extra: t.expr(t.number) },
	inputs: { rates: t.map(ERate), main: EGroup },
	derived: {
		total: e.sum(e.each("groups", "subtotal")),
		rateSE: raw(["ref", "rates", { key: "SE" }, "percent"]),
	},
});
const quotes = kit({
	name: "quotes",
	version: "1.0.0",
	root: EQuote,
	entities: [EQuote, EGroup, ERow, ERate],
});

const tree = {
	config: {
		groups: {
			hardware: { type: "group", config: { bonus: 0 } },
			services: { type: "group", config: { bonus: 100 } },
		},
		// a Builder's formula reading into a placed map
		extra: ["mul", ["ref", "groups", "services", "subtotal"], 2],
	},
} as const;

const start = (replica = "c1") => {
	const program = quotes.program(tree);
	const session = program.run([], { replica });
	return { program, session, root: session.root };
};
const value = (r: unknown) => (r as { value: unknown }).value;
/** The value, for a handle a test knows is there. */
const must = <T>(x: T | undefined): T => {
	if (x === undefined) throw new Error("expected a handle");
	return x;
};

describe("collections the Builder places", () => {
	it("checks the tree without diagnostics", () => {
		expect(start().program.diagnostics).toEqual([]);
	});

	it("sums over a placed map, and reads into it from a formula", () => {
		const { session, root } = start();
		const hardware = must(root.map("groups").get("hardware"));
		const row = hardware.list("rows").add();
		row.member("qty").set(2);
		row.member("price").set(10);
		expect(value(root.member("total").get())).toBe(120);
		expect(value(root.member("extra").get())).toBe(200);
		expect(session.at(["groups", "services", "subtotal"])?.get()).toEqual({
			ok: true,
			value: 100,
		});
	});

	it("gives handles to placed maps and entities", () => {
		const { root } = start();
		const groups = root.map("groups");
		expect(groups.entries().map(([key]) => key)).toEqual([
			"hardware",
			"services",
		]);
		expect(groups.get("hardware")?.type).toBe("group");
		expect(groups.get("hardware")?.parent).toBe(root);
		expect(groups.get("nope")).toBeUndefined();
		expect(root.entity("main").type).toBe("group");
		expect(root.entity("main").parent).toBe(root);
		expect(() => groups.add("more")).toThrow();
	});

	it("reports what doesn't fit as diagnostics", () => {
		const program = quotes.program({
			config: {
				groups: {
					one: { type: "row" },
					two: { type: "grup" },
					"3": { type: "group", config: { bonus: 0 } },
					four: {
						type: "group",
						config: { bonus: ["ref", "rows", "$each", "qty"] },
					},
					five: { type: "group", config: { bonus: ["ref", "rows", "c1:1"] } },
				},
				extra: ["ref", "groups", "six", "subtotal"],
			},
		} as never);
		// "3" comes first: JavaScript orders integer keys first, which is why keys start with a letter
		expect(program.diagnostics.map((d) => [d.code, d.at])).toEqual([
			["key.invalid", ["groups"]],
			["node.type", ["groups", "one"]],
			["node.unknown", ["groups", "two"]],
			["ref.unknown", []],
			["ref.list", ["groups", "four"]],
			["ref.unknown", ["groups", "five"]],
		]);
	});
});

describe("lists", () => {
	it("inserts, moves and reads by position, following elements", () => {
		const { root } = start();
		const main = root.entity("main");
		const rows = main.list("rows");
		const a = rows.add();
		const b = rows.add();
		const c = rows.insert(0);
		for (const [row, price] of [
			[a, 1],
			[b, 2],
			[c, 3],
		] as const) {
			row.member("price").set(price);
		}
		expect(value(main.member("first").get())).toBe(3);
		expect(value(main.member("last").get())).toBe(2);
		rows.move(c.id, 2);
		expect(rows.entries().map(([id]) => id)).toEqual([a.id, b.id, c.id]);
		expect(value(main.member("first").get())).toBe(1);
		expect(value(main.member("last").get())).toBe(3);
		expect(value(c.member("position").get())).toBe(2);
	});

	it("keeps a running value through $prev", () => {
		const { root } = start();
		const rows = root.entity("main").list("rows");
		const a = rows.add();
		const b = rows.add();
		a.member("price").set(5);
		b.member("price").set(7);
		const running = b.member("running");
		const heard = vi.fn();
		running.subscribe(heard);
		expect(value(running.get())).toBe(12);

		rows.insert(1).member("price").set(100);
		expect(value(running.get())).toBe(112);
		rows.remove(a.id);
		expect(value(running.get())).toBe(107);
		expect(heard).toHaveBeenCalledTimes(2);
	});

	it("reads null for a position or id that has nothing", () => {
		const { root } = start();
		const main = root.entity("main");
		expect(main.member("first").get()).toEqual({ ok: true, value: null });
		const row = main.list("rows").add();
		row.member("price").set(4);
		expect(value(main.member("first").get())).toBe(4);
		main.list("rows").remove(row.id);
		expect(main.member("first").get()).toEqual({ ok: true, value: null });
	});

	it("tells subscribers when rows come and go", () => {
		const { root } = start();
		const rows = root.entity("main").list("rows");
		const heard = vi.fn();
		const path = vi.fn();
		rows.subscribe(heard);
		root.subscribe(["main", "rows"], path);
		const row = rows.add();
		rows.add();
		rows.move(row.id, 1);
		rows.remove(row.id);
		expect(heard).toHaveBeenCalledTimes(4);
		expect(path).toHaveBeenCalledTimes(4);
	});
});

describe("maps the Operator fills", () => {
	it("adds, reads and removes by key", () => {
		const { root } = start();
		const rates = root.map("rates");
		const se = rates.add("SE");
		rates.add("NO");
		se.member("percent").set(25);
		expect(value(se.member("country").get())).toBe("SE");
		expect(value(root.member("rateSE").get())).toBe(25);
		expect(rates.get("SE")).toBe(se);
		expect(rates.entries().map(([k]) => k)).toEqual(["SE", "NO"]);
		expect(() => rates.add("SE")).toThrow(/already has/);

		rates.remove("SE");
		expect(rates.get("SE")).toBeUndefined();
		expect(value(root.member("rateSE").get())).toBe(null);
	});

	it("starts a key added again afresh", () => {
		const { root } = start();
		const rates = root.map("rates");
		rates.add("SE").member("percent").set(25);
		rates.remove("SE");
		const again = rates.add("SE");
		expect(value(again.member("percent").get())).toBe(0);
		expect(value(root.member("rateSE").get())).toBe(0);
	});

	it("merges two Operators' adds of the same key into one element", () => {
		const one = start("c1").session;
		const two = start("c2").session;
		const fromOne: Op[] = [];
		const fromTwo: Op[] = [];
		one.onApply((op) => fromOne.push(op));
		two.onApply((op) => fromTwo.push(op));
		one.root.map("rates").add("SE");
		two.root.map("rates").add("SE").member("percent").set(9);
		one.apply(fromTwo.splice(0));
		two.apply(fromOne.splice(0));
		expect(one.snapshot()).toEqual(two.snapshot());
		expect((one.snapshot() as { rates: unknown }).rates).toEqual({
			SE: { percent: 9, country: "SE" },
		});
	});

	it("replays to the same snapshot", () => {
		const { program, session, root } = start();
		root.map("rates").add("DK").member("percent").set(25);
		root.entity("main").list("rows").add().member("price").set(3);
		const replayed = program.run(
			JSON.parse(JSON.stringify(session.ops())) as Op[],
		);
		expect(replayed.snapshot()).toEqual(session.snapshot());
	});
});

describe("aggregates", () => {
	it("count, min, max and any skip null and stay up to date", () => {
		const { root } = start();
		const main = root.entity("main");
		const rows = main.list("rows");
		const [a, b, c] = [rows.add(), rows.add(), rows.add()];
		a.member("price").set(5);
		b.member("price").set(2);
		void c; // price stays null
		const get = (m: "count" | "cheapest" | "dearest" | "anyDone" | "allDone") =>
			value(main.member(m).get());
		expect([get("count"), get("cheapest"), get("dearest")]).toEqual([2, 2, 5]);
		rows.remove(b.id);
		expect([get("count"), get("cheapest"), get("dearest")]).toEqual([1, 5, 5]);
		c.member("price").set(9);
		expect([get("count"), get("cheapest"), get("dearest")]).toEqual([2, 5, 9]);

		expect([get("anyDone"), get("allDone")]).toEqual([false, false]);
		a.member("done").set(true);
		expect([get("anyDone"), get("allDone")]).toEqual([true, false]);
		c.member("done").set(true);
		expect([get("anyDone"), get("allDone")]).toEqual([true, true]);
	});

	it("are errors when an element's value is, unless sumValid skips them", () => {
		const EItem = entity("item", {
			inputs: { a: t.number.initial(1), b: t.number.initial(1) },
			derived: { ratio: e.div(e.self("a"), e.self("b")) },
		});
		const ESheet = entity("sheet", {
			inputs: { items: t.list(EItem) },
			derived: {
				sum: e.sum(e.each("items", "ratio")),
				valid: raw(["sumValid", ["ref", "items", "$each", "ratio"]]),
				several: raw(["sum", 1, null, 2]),
			},
		});
		const sheets = kit({
			name: "sheets",
			version: "1.0.0",
			root: ESheet,
			entities: [ESheet, EItem],
		});
		const session = sheets.program({}).run();
		const items = session.root.list("items");
		items.add();
		items.add().member("b").set(0);
		const sum = session.root.member("sum").get();
		expect(!sum.ok && sum.error.code).toBe("div.zero");
		expect(value(session.root.member("valid").get())).toBe(1);
		expect(value(session.root.member("several").get())).toBe(3);
	});

	it("take your own, incremental or recomputed", () => {
		const add = vi.fn((acc: number, v: number) => acc + v);
		const total = fn("total", {
			params: [{ xs: t.list(t.number) }],
			returns: t.number,
			aggregate: fn.aggregate({
				init: 0,
				add,
				remove: (acc: number, v: number) => acc - v,
				result: (acc: number) => acc,
			}),
		});
		const joined = fn("joined", {
			params: [{ xs: t.list(t.number) }],
			returns: t.text,
			aggregate: fn.aggregate({
				init: [] as number[],
				add: (acc: number[], v: number) => [...acc, v],
				result: (acc: number[]) => acc.join(","),
				recompute: true,
			}),
		});
		const ECell = entity("cell", { inputs: { v: t.number.initial(0) } });
		const EList = entity("list", {
			inputs: { cells: t.list(ECell) },
			derived: {
				total: raw(["total", ["ref", "cells", "$each", "v"]]),
				joined: raw<string>(["joined", ["ref", "cells", "$each", "v"]]),
			},
		});
		const lists = kit({
			name: "lists",
			version: "1.0.0",
			functions: { total, joined },
			root: EList,
			entities: [EList, ECell],
		});
		const session = lists.program({}).run();
		const cells = session.root.list("cells");
		for (let i = 1; i <= 3; i++) cells.add().member("v").set(i);
		expect(value(session.root.member("total").get())).toBe(6);
		expect(value(session.root.member("joined").get())).toBe("1,2,3");

		add.mockClear();
		cells.insert(0).member("v").set(9);
		expect(value(session.root.member("total").get())).toBe(15);
		expect(add).toHaveBeenCalledTimes(1); // only the new cell
		expect(value(session.root.member("joined").get())).toBe("9,1,2,3");
	});
});

describe("snapshots", () => {
	it("show lists as arrays with ids, and maps and placed entities as objects", () => {
		const { session, root } = start();
		root.map("rates").add("SE");
		const row = root.entity("main").list("rows").add();
		row.member("price").set(2);
		const snapshot = session.snapshot() as {
			rates: unknown;
			main: { rows: unknown };
			groups: object;
		};
		expect(snapshot.rates).toEqual({ SE: { percent: 0, country: "SE" } });
		expect(snapshot.main.rows).toEqual([
			{
				id: row.id,
				qty: 1,
				price: 2,
				done: false,
				total: 2,
				position: 0,
				running: 2,
			},
		]);
		expect(Object.keys(snapshot.groups)).toEqual(["hardware", "services"]);
	});
});
