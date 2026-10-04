// The walking skeleton: one program through every module, from kit() to snapshot().

import { describe, expect, it, vi } from "vitest";
import { e, entity, fn, kit, type Op, t } from "..";
import type { Ex, KnownN } from "../kit";

const ERow = entity("row", { inputs: { amount: t.number.initial(0) } });
const EQuote = entity("quote", {
	inputs: {
		a: t.number.initial(2),
		b: t.number.initial(3),
		rows: t.list(ERow),
	},
	derived: {
		product: e.mul(e.self("a"), e.self("b")),
		total: e.sum(e.each("rows", "amount")),
	},
});
const quotes = kit({
	name: "quotes",
	version: "1.0.0",
	root: EQuote,
	entities: [EQuote, ERow],
});

describe("the walking skeleton", () => {
	it("computes a derived value from two inputs", () => {
		const session = quotes.program({}).run();
		expect(session.root.member("product").get()).toEqual({
			ok: true,
			value: 6,
		});
	});

	it("starts from the Builder's initial values", () => {
		const session = quotes.program({ inputs: { a: 5 } }).run();
		expect(session.root.member("product").get()).toEqual({
			ok: true,
			value: 15,
		});
	});

	it("recomputes on set and notifies subscribers once per change", () => {
		const session = quotes.program({}).run([], { replica: "c1" });
		const product = session.root.member("product");
		const heard = vi.fn();
		product.subscribe(heard);

		const op = session.root.member("a").set(10);
		expect(op).toEqual({
			ok: true,
			value: { t: "set", at: ["a"], v: 10, clock: "c1:1" },
		});
		expect(product.get()).toEqual({ ok: true, value: 30 });
		expect(heard).toHaveBeenCalledTimes(1);

		session.root.member("b").set(3); // the same value: no change to hear about
		expect(heard).toHaveBeenCalledTimes(1);
	});

	it("returns the same get() object until the value changes", () => {
		const session = quotes.program({}).run();
		const product = session.root.member("product");
		const first = product.get();
		expect(product.get()).toBe(first);
		session.root.member("a").set(4);
		expect(product.get()).not.toBe(first);
	});

	it("gives the same handle for the same member", () => {
		const session = quotes.program({}).run();
		expect(session.root.member("a")).toBe(session.root.member("a"));
		expect(session.root.list("rows")).toBe(session.at(["rows"]));
	});

	it("sums a list and keeps the sum up to date", () => {
		const session = quotes.program({}).run();
		const rows = session.root.list("rows");
		const total = session.root.member("total");
		const heard = vi.fn();
		total.subscribe(heard);
		expect(total.get()).toEqual({ ok: true, value: 0 });

		const first = rows.add();
		const second = rows.add();
		first.member("amount").set(0.1);
		second.member("amount").set(0.2);
		// exact, then rounded once: the same as 0.1 + 0.2 here, but never order-dependent
		expect(total.get()).toEqual({ ok: true, value: 0.30000000000000004 });

		rows.remove(first.id);
		expect(total.get()).toEqual({ ok: true, value: 0.2 });
		expect(heard).toHaveBeenCalledTimes(3);
	});

	it("folds one element at a time", () => {
		const add = vi.fn((acc: number, v: number) => acc + v);
		const remove = vi.fn((acc: number, v: number) => acc - v);
		const count = fn("total", {
			params: { xs: t.list(t.number) },
			returns: t.number,
			aggregate: fn.aggregate({ init: 0, add, remove, result: (acc) => acc }),
		});
		const counting = kit({
			name: "counting",
			version: "1.0.0",
			functions: { sum: count },
			root: EQuote,
			entities: [EQuote, ERow],
		});
		const session = counting.program({}).run();
		const rows = session.root.list("rows");
		session.batch(() => {
			for (let i = 0; i < 100; i++) rows.add().member("amount").set(i);
		});
		session.root.member("total").subscribe(() => {});
		expect(session.root.member("total").get()).toEqual({
			ok: true,
			value: 4950,
		});

		add.mockClear();
		rows.at(50)?.member("amount").set(1000);
		expect(session.root.member("total").get()).toEqual({
			ok: true,
			value: 5900,
		});
		expect(add).toHaveBeenCalledTimes(1);
		expect(remove).toHaveBeenCalledTimes(1);
	});

	it("puts a clock on every op and replays them to the same values", () => {
		const program = quotes.program({});
		const session = program.run([], { replica: "c1" });
		const row = session.root.list("rows").add();
		row.member("amount").set(7);
		session.root.member("b").set(4);

		const ops = session.ops();
		expect(ops.map((op) => op.clock)).toEqual(["c1:1", "c1:2", "c1:3"]);
		const replayed = program.run(JSON.parse(JSON.stringify(ops)) as Op[]);
		expect(replayed.snapshot()).toEqual(session.snapshot());
		expect(session.snapshot()).toEqual({
			a: 2,
			b: 4,
			rows: [{ id: "c1:1", amount: 7 }],
			product: 8,
			total: 7,
		});
	});

	it("lets two Operators converge whatever order their ops arrive in", () => {
		const program = quotes.program({});
		const one = program.run([], { replica: "c1" });
		const two = program.run([], { replica: "c2" });
		const fromOne: Op[] = [];
		const fromTwo: Op[] = [];
		one.onApply((op) => fromOne.push(op));
		two.onApply((op) => fromTwo.push(op));

		one.root.member("a").set(10);
		two.root.member("a").set(20); // the same counter; the higher replica id wins
		one.apply(fromTwo.splice(0));
		two.apply(fromOne.splice(0));

		expect(one.root.member("a").get()).toEqual({ ok: true, value: 20 });
		expect(two.root.member("a").get()).toEqual({ ok: true, value: 20 });
		expect(one.snapshot()).toEqual(two.snapshot());
	});

	it("notifies once for a batch", () => {
		const session = quotes.program({}).run();
		const heard = vi.fn();
		session.root.member("product").subscribe(heard);
		session.batch(() => {
			session.root.member("a").set(5);
			session.root.member("b").set(5);
		});
		expect(heard).toHaveBeenCalledTimes(1);
		expect(session.root.member("product").get()).toEqual({
			ok: true,
			value: 25,
		});
	});

	it("reports a broken formula as a diagnostic and as the value's error", () => {
		const EBroken = entity("broken", {
			inputs: { a: t.number.initial(1) },
			// one argument short, as a Builder might write it
			derived: {
				bad: ["mul", ["ref", "a"]] as never,
				uses: e.add(e.self("bad"), 1),
			},
		});
		const broken = kit({
			name: "broken",
			version: "1.0.0",
			root: EBroken,
			entities: [EBroken],
		});
		const program = broken.program({});
		expect(program.diagnostics.map((d) => d.code)).toEqual(["call.arity"]);
		const uses = program.run().root.member("uses").get();
		expect(uses.ok).toBe(false);
		if (!uses.ok) {
			expect(uses.error.code).toBe("call.arity");
			expect(uses.error.at).toEqual(["uses"]);
			expect(uses.error.cause?.at).toEqual(["bad"]);
		}
	});

	it("finds members by path, with positions or ids", () => {
		const session = quotes.program({}).run([], { replica: "c1" });
		const row = session.root.list("rows").add();
		row.member("amount").set(3);
		expect(session.at(["rows", 0, "amount"])?.get()).toEqual({
			ok: true,
			value: 3,
		});
		expect(session.at(["rows", { id: row.id }, "amount"])).toBe(
			row.member("amount"),
		);
		expect(session.at(["rows", 1, "amount"])).toBeUndefined();
	});

	it("finds a path from an entity with entity.at", () => {
		const session = quotes.program({}).run([], { replica: "c1" });
		const row = session.root.list("rows").add();
		expect(row.at(["amount"])).toBe(row.member("amount"));
		expect(session.root.at(["rows", 0])).toBe(row);
		expect(session.root.at(["rows", 1])).toBeUndefined();
	});
});

describe("subscriptions", () => {
	it("stops notifying after unsubscribe, and keeps the other subscribers", () => {
		const session = quotes.program({}).run();
		const product = session.root.member("product");
		const one = vi.fn();
		const two = vi.fn();
		const unsubscribe = product.subscribe(one);
		product.subscribe(two);

		session.root.member("a").set(4);
		unsubscribe();
		session.root.member("a").set(5);

		expect(one).toHaveBeenCalledTimes(1);
		expect(two).toHaveBeenCalledTimes(2);
		expect(product.get()).toEqual({ ok: true, value: 15 });
	});

	it("still computes a value no one subscribes to when it is read", () => {
		const session = quotes.program({}).run();
		const product = session.root.member("product");
		product.subscribe(() => {})();
		session.root.member("a").set(7);
		expect(product.get()).toEqual({ ok: true, value: 21 });
	});

	it("subscribes through a path", () => {
		const session = quotes.program({}).run([], { replica: "c1" });
		const heard = vi.fn();
		session.at(["product"])?.subscribe(heard);
		session.root.member("a").set(4);
		expect(heard).toHaveBeenCalledTimes(1);

		const row = session.root.list("rows").add();
		const amount = vi.fn();
		session.at(["rows", 0, "amount"])?.subscribe(amount);
		row.member("amount").set(9);
		expect(amount).toHaveBeenCalledTimes(1);
	});

	it("follows the row it subscribed to when a row is inserted before it", () => {
		const session = quotes.program({}).run([], { replica: "c1" });
		const rows = session.root.list("rows");
		rows.add();
		const second = rows.add();
		const heard = vi.fn();
		// by position, but the handle is for the row now at 1, wherever it moves
		const amount = session.at(["rows", 1, "amount"]);
		expect(amount).toBe(second.member("amount"));
		amount?.subscribe(heard);

		const inserted = rows.insert(0);
		inserted.member("amount").set(5); // now at 0; the subscribed row is at 2
		expect(heard).not.toHaveBeenCalled();

		second.member("amount").set(6);
		expect(heard).toHaveBeenCalledTimes(1);
		expect(rows.at(2)).toBe(second);
		expect(session.at(["rows", 2, "amount"])?.get()).toEqual({
			ok: true,
			value: 6,
		});
	});

	it("follows a position when subscribing to a path from an entity", () => {
		const session = quotes.program({}).run([], { replica: "c1" });
		const rows = session.root.list("rows");
		const first = rows.add();
		const second = rows.add();
		first.member("amount").set(1);
		second.member("amount").set(2);
		const heard = vi.fn();
		const stop = session.root.subscribe(["rows", 0, "amount"], heard);

		rows.add(); // the first row is still first: nothing to hear
		expect(heard).not.toHaveBeenCalled();

		rows.remove(first.id); // now the path names the second row, worth 2
		expect(heard).toHaveBeenCalledTimes(1);
		first.member("amount").set(10); // removed, no longer followed
		expect(heard).toHaveBeenCalledTimes(1);
		second.member("amount").set(3);
		expect(heard).toHaveBeenCalledTimes(2);

		// a new first row: another element, even though it is worth the same 3
		session.batch(() => rows.insert(0).member("amount").set(3));
		expect(heard).toHaveBeenCalledTimes(3);

		stop();
		rows.remove(rows.at(0)?.id as string);
		expect(heard).toHaveBeenCalledTimes(3);
	});

	it("notifies every subscribed value that changed, including one another reads", () => {
		const session = quotes.program({}).run();
		const product = vi.fn();
		const a = vi.fn();
		session.root.member("product").subscribe(product); // reads a
		session.root.member("a").subscribe(a);
		session.root.member("a").set(9);
		expect(product).toHaveBeenCalledTimes(1);
		expect(a).toHaveBeenCalledTimes(1);
	});
});

describe("recomputing", () => {
	it("stops at a value that didn't change", () => {
		const zero = vi.fn(() => 0);
		const plus = vi.fn(({ a, b }: { a: number; b: number }) => a + b);
		const num = { params: { a: t.number }, returns: t.number };
		const ESteps = entity("steps", {
			inputs: { a: t.number.initial(1) },
			derived: {
				// raw JSON, as a Builder writes it
				flat: ["zero", ["ref", "a"]] as unknown as Ex<KnownN<number>>,
				after: ["plus", ["ref", "flat"], 1] as unknown as Ex<KnownN<number>>,
			},
		});
		const steps = kit({
			name: "steps",
			version: "1.0.0",
			functions: {
				zero: fn("zero", { ...num, impl: zero }),
				plus: fn("plus", {
					params: { a: t.number, b: t.number },
					returns: t.number,
					impl: plus,
				}),
			},
			root: ESteps,
			entities: [ESteps],
		});
		const session = steps.program({}).run();
		const after = session.root.member("after");
		const heard = vi.fn();
		after.subscribe(heard);
		expect(after.get()).toEqual({ ok: true, value: 1 });

		session.root.member("a").set(2);
		expect(zero).toHaveBeenCalledTimes(2); // flat recomputed, still 0
		expect(plus).toHaveBeenCalledTimes(1); // so after wasn't
		expect(heard).not.toHaveBeenCalled();
	});
});
