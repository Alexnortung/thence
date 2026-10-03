// Writable derived values: a write goes back through inverses to one input.

import { describe, expect, it } from "vitest";
import { e, entity, fn, kit, std, t } from "..";
import type { Ex, KnownN } from "../kit";

/** A Builder's formula as raw JSON. */
const raw = <V = number>(json: unknown) => json as Ex<KnownN<V>>;
const value = (r: unknown) => String((r as { value: unknown }).value);
/** `set` on a member whose type doesn't say it is writable, such as a Builder's formula. */
const write = (member: object, v: unknown) =>
	(member as { set(v: unknown): unknown }).set(v);

const Money = t.decimal("Money", { scale: 2 });
const Percent = t.decimal("Percent", { scale: 4 });

const toFahrenheit = fn("toFahrenheit", {
	params: { celsius: t.number },
	returns: t.number,
	body: ({ celsius }) => e.add(e.div(e.mul(celsius, 9), 5), 32),
});
const margin = fn("margin", {
	params: { price: t.number, cost: t.number },
	returns: t.number,
	body: ({ price, cost }) => e.div(e.sub(price, cost), price),
});
const fromCode = fn("fromCode", {
	params: { code: t.int },
	returns: t.text,
	impl: ({ code }) => String(code),
	inverse: { code: ({ result }) => Number(result) },
});

const EItem = entity("item", {
	inputs: { qty: t.int.initial(1), price: Money.initial("100.00") },
	derived: {
		lineTotal: e.mul(e.self("price"), e.self("qty")),
		tenths: e.mul(e.self("qty"), 0.1),
	},
});
const EQuote = entity("quote", {
	inputs: {
		rows: t.list(EItem),
		discountPercent: Percent.initial(0),
		celsius: t.number.initial(0),
		cost: t.number.initial(60),
		code: t.int.initial(7),
	},
	derived: {
		subtotal: e.sum(e.each("rows", "lineTotal")),
		discountAmount: e.div(
			e.mul(e.self("subtotal"), e.self("discountPercent")),
			100,
		),
		total: e.sub(e.self("subtotal"), e.self("discountAmount")),
		fahrenheit: e.call(toFahrenheit, { celsius: e.self("celsius") }),
		margin: e.call(margin, { price: raw(100), cost: e.self("cost") }),
		label: e.call(fromCode, { code: e.self("code") }),
		firstQty: raw(["ref", "rows", { at: 0 }, "qty"]),
	},
});
const EField = entity("field", { config: { value: t.expr(t.number) } });
const EForm = entity("form", {
	config: { fields: t.map(EField) },
	inputs: { price: t.number.initial(4), extra: t.number.initial(1) },
});
const quotes = kit({
	name: "quotes",
	version: "1",
	root: EQuote,
	entities: [EQuote, EItem],
	functions: { ...std, toFahrenheit, margin, fromCode },
});
const forms = kit({
	name: "forms",
	version: "1",
	root: EForm,
	entities: [EForm, EField],
	functions: { ...std },
});

const start = () => {
	const session = quotes.program({}).run([], { replica: "c1" });
	return { session, root: session.root };
};

describe("writable derived values", () => {
	it("writes through to the one input, and the log records the input", () => {
		const { session, root } = start();
		root.list("rows").add().member("qty").set(2);
		const r = root.member("discountAmount").set("50.00");
		expect(r).toMatchObject({
			ok: true,
			value: { t: "set", at: ["discountPercent"], v: "25.0000" },
		});
		expect(value(root.member("discountAmount").get())).toBe("50.00");
		expect(value(root.member("total").get())).toBe("150.00");
		expect(session.ops().at(-1)).toMatchObject({ at: ["discountPercent"] });
	});

	it("writes through a value that is writable itself", () => {
		const { root } = start();
		root.list("rows").add().member("qty").set(3);
		root.member("total").set("200.00");
		expect(value(root.member("discountAmount").get())).toBe("100.00");
		expect(value(root.member("discountPercent").get())).toBe("33.3333");
	});

	it("changes nothing when an inverse has no answer", () => {
		const { session, root } = start();
		const before = session.ops().length;
		expect(root.member("discountAmount").set("50.00")).toMatchObject({
			ok: false,
			error: { code: "write.noAnswer", at: ["discountAmount"] },
		});
		expect(session.ops().length).toBe(before);
	});

	it("isn't writable with two inputs, or through an aggregate", () => {
		const { root } = start();
		const row = root.list("rows").add();
		expect(row.member("lineTotal").writable()).toBe(false);
		expect(root.member("subtotal").writable()).toBe(false);
		expect(root.member("discountAmount").writable()).toBe(true);
		expect(write(row.member("lineTotal"), "5.00")).toMatchObject({
			ok: false,
			error: { code: "write.readonly" },
		});
	});

	it("derives a body's inverse, but not for a parameter it uses twice", () => {
		const { root } = start();
		root.member("fahrenheit").set(212);
		expect(value(root.member("celsius").get())).toBe("100");
		root.member("margin").set(0.25);
		expect(value(root.member("cost").get())).toBe("75");
	});

	it("uses an impl's hand-written inverse", () => {
		const { root } = start();
		root.member("label").set("42");
		expect(value(root.member("code").get())).toBe("42");
	});

	it("rounds for an int input after an inverse", () => {
		const { root } = start();
		const row = root.list("rows").add();
		row.member("tenths").set(0.3);
		expect(value(row.member("qty").get())).toBe("3");
	});

	it("follows a lookup to the element it finds now", () => {
		const { root } = start();
		expect(root.member("firstQty").writable()).toBe(false);
		const rows = root.list("rows");
		const first = rows.add();
		rows.add();
		expect(root.member("firstQty").writable()).toBe(true);
		const r = write(root.member("firstQty"), 5);
		expect(r).toMatchObject({
			ok: true,
			value: { at: ["rows", first.id, "qty"] },
		});
		expect(value(first.member("qty").get())).toBe("5");
	});

	it("tells whether a Builder's formula accepts writes", () => {
		const program = forms.program({
			config: {
				fields: {
					doubled: {
						type: "field",
						config: { value: ["mul", ["ref", "$parent", "price"], 2] },
					},
					both: {
						type: "field",
						config: {
							value: [
								"add",
								["ref", "$parent", "price"],
								["ref", "$parent", "extra"],
							],
						},
					},
					fixed: { type: "field", config: { value: 3 } },
				},
			},
		} as never);
		expect(program.diagnostics).toEqual([]);
		const session = program.run();
		const field = (k: string) => {
			const f = session.root.map("fields").get(k);
			if (!f) throw new Error(`no field ${k}`);
			return f.member("value");
		};
		expect(field("doubled").writable()).toBe(true);
		expect(field("both").writable()).toBe(false);
		expect(field("fixed").writable()).toBe(false);
		write(field("doubled"), 10);
		expect(value(session.root.member("price").get())).toBe("5");
	});
});
