// Value types and nullability: what the checker knows about every expression.

import { describe, expect, it } from "vitest";
import { e, entity, fn, impl, kit, t, trait } from "..";
import type { Ex, KnownN } from "../kit";

const raw = (json: unknown) => json as Ex<KnownN<number>>;
const value = (r: unknown) => String((r as { value: unknown }).value);

const Money = t.decimal("Money", { scale: 2 });
const Percent = t.decimal("Percent", { scale: 4 });
const nan = fn("nan", {
	params: { x: t.number },
	returns: t.number,
	impl: () => Number.NaN,
});

const TPriced = trait("priced", { total: Money });
const ERow = entity("row", { inputs: { price: Money.initial("1.50") } });
const EQuote = entity("quote", {
	config: {
		fee: t.expr(Money),
		formula: t.expr(t.number).optional(),
		label: t.text.optional(),
	},
	inputs: {
		price: Money.initial("10.00"),
		pct: Percent.initial("12.5000"),
		qty: t.int.initial(3),
		note: t.text.nullable(),
		maybePrice: Money.nullable(),
		maybeNum: t.number.nullable(),
		day: t.date.initial("2026-10-03"),
		rows: t.list(ERow),
	},
	derived: {
		discount: e.mul(e.self("price"), e.self("pct")),
		twice: e.mul(2, e.self("price")),
		rowsTotal: e.sum(e.each("rows", "price")),
		maybeQty: raw(["add", ["ref", "qty"], ["ref", "maybeNum"]]),
		zero: raw(["mul", -1, 0]),
		broken: raw(["nan", 1]),
	},
	impls: [impl(TPriced, { total: e.self("fee") })],
});
const quotes = kit({
	name: "quotes",
	version: "1",
	root: EQuote,
	entities: [EQuote, ERow],
	functions: { nan },
});

const tree = (config: Record<string, unknown> = {}, inputs = {}) =>
	({ config: { fee: 5, ...config }, inputs }) as never;
const codes = (config: Record<string, unknown>, inputs = {}) =>
	quotes.check(tree(config, inputs)).map((d) => [d.code, d.field]);

describe("value types", () => {
	it("makes a number literal a value of the declared type", () => {
		const session = quotes.program(tree()).run();
		expect(value(session.root.as(TPriced).member("total").get())).toBe("5.00");
	});

	it("gives decimal arithmetic the first custom-typed argument's type", () => {
		const { root } = quotes.program(tree()).run();
		expect(value(root.member("discount").get())).toBe("125.00");
		expect(value(root.member("twice").get())).toBe("20.00");
	});

	it("gives an empty decimal sum the decimal's scale", () => {
		const { root } = quotes.program(tree()).run();
		expect(value(root.member("rowsTotal").get())).toBe("0.00");
	});

	it("reports a formula of the wrong type where it goes", () => {
		expect(codes({ fee: ["ref", "pct"] })).toEqual([["type.mismatch", "fee"]]);
		expect(codes({ fee: ["ref", "day"] })).toEqual([["type.mismatch", "fee"]]);
		expect(codes({ formula: ["ref", "qty"] })).toEqual([]);
	});

	it("reports a call that fits no signature", () => {
		expect(codes({ formula: ["add", ["text", "a"], 1] })).toEqual([
			["call.types", "formula"],
		]);
	});

	it("checks the Builder's values and initial values against their types", () => {
		expect(codes({ label: 3 }, { qty: 1.5, price: "2.50" })).toEqual([
			["type.mismatch", "qty"],
			["type.mismatch", "label"],
		]);
		const { root } = quotes.program(tree({}, { qty: 1.5 })).run();
		expect(value(root.member("qty").get())).toBe("3");
	});

	it("rejects a date that doesn't exist", () => {
		const session = quotes.program(tree()).run();
		const r = session.root.member("day").set("2026-02-30");
		expect(r).toMatchObject({ ok: false, error: { code: "op.type" } });
	});

	it("turns NaN into an error and -0 into 0", () => {
		const { root } = quotes.program(tree()).run();
		expect(root.member("broken").get()).toMatchObject({
			ok: false,
			error: { code: "number.nan" },
		});
		const zero = root.member("zero").get();
		expect(Object.is((zero as { value: unknown }).value, 0)).toBe(true);
	});
});

describe("nullability", () => {
	it("reports a value that can be empty where it can't", () => {
		expect(codes({ fee: ["ref", "maybePrice"] })).toEqual([
			["type.nullable", "fee"],
		]);
		expect(
			codes({ formula: ["add", ["ref", "qty"], ["ref", "maybeNum"]] }),
		).toEqual([["type.nullable", "formula"]]);
	});

	it("lets a derived value be empty, and passes null through a call", () => {
		const { root } = quotes.program(tree()).run();
		expect(root.member("maybeQty").get()).toEqual({ ok: true, value: null });
		root.member("maybeNum").set(2);
		expect(root.member("maybeQty").get()).toEqual({ ok: true, value: 5 });
	});
});
