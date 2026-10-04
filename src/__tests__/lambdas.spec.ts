// Lambdas: map and filter over collections and JSON arrays, derived
// collections at their own addresses, and derived entities.

import { describe, expect, it } from "vitest";
import { e, entity, fn, impl, kit, t, trait } from "..";
import type { AnyEntity, Ex, KnownN } from "../kit";

/** A Builder's formula as raw JSON. */
const raw = <V = number>(json: unknown) => json as Ex<KnownN<V>>;
const value = (r: unknown) => (r as { value: unknown }).value;
const must = <T>(x: T | undefined): T => {
	if (x === undefined) throw new Error("expected a handle");
	return x;
};

const gt = fn("gt", {
	params: { a: t.number, b: t.number },
	returns: t.bool,
	impl: ({ a, b }) => a > b,
});
/** How many times `line` ran, to see a map's lambda run once per changed row. */
let lineCalls = 0;
const line = fn("line", {
	params: { qty: t.number, price: t.number },
	returns: t.number,
	impl: ({ qty, price }) => {
		lineCalls++;
		return qty * price;
	},
});

const TBig = trait("big", { rows: t.list(() => ERow) });
const EVat = entity("vat", {
	inputs: { base: t.number.initial(0), rate: t.number.initial(0) },
	derived: { amount: e.div(e.mul(e.self("base"), e.self("rate")), 100) },
});
const TSized = trait("sized", { size: t.number });
const ERow = entity("row", {
	inputs: { qty: t.number.initial(0), unitPrice: t.number.initial(0) },
	impls: [impl(TSized, { size: e.mul(e.self("qty"), 10) })],
});
const EInvoiceLine = entity("invoiceLine", {
	inputs: { amount: t.number.initial(0), qty: t.number.initial(0) },
	derived: { doubled: e.mul(e.self("amount"), 2) },
});
const EOrder = entity("order", {
	inputs: {
		rows: t.list(ERow),
		rates: t.map(ERow),
		limit: t.number.initial(10),
		tags: t.json.initial([
			{ name: "a", n: 1 },
			{ name: "b", n: 2 },
			{ name: "c", n: 3 },
		]),
		rate: t.number.initial(25),
	},
	derived: {
		total: e.sum(
			e.map(
				e.self("rows"),
				e.fn((row) =>
					e.call(line, { qty: row("qty"), price: row("unitPrice") }),
				),
			),
		),
		bigRows: e.filter(
			e.self("rows"),
			e.fn((row) => e.call(gt, { a: row("qty"), b: e.self("limit") })),
		),
		biggest: e.filter(
			e.self("bigRows"),
			e.fn((row) => e.call(gt, { a: row("qty"), b: 100 })),
		),
		bigQty: raw(["sum", ["ref", "bigRows", "$each", "qty"]]),
		bigViaTrait: raw(["sum", ["ref", { as: "big" }, "rows", "$each", "qty"]]),
		bigCount: raw([
			"count",
			[
				"filter",
				["ref", "rows"],
				["fn", ["r"], ["gt", ["ref", "r", "qty"], ["ref", "limit"]]],
			],
		]),
		invoiceLines: e.map(
			e.self("rows"),
			e.fn((row) =>
				e.entity(EInvoiceLine, {
					amount: e.mul(row("qty"), row("unitPrice")),
					qty: row("qty"),
				}),
			),
		),
		linesTotal: raw(["sum", ["ref", "invoiceLines", "$each", "doubled"]]),
		rateLines: e.map(
			e.self("rates"),
			e.fn((row) => e.entity(EInvoiceLine, { amount: row("qty"), qty: 0 })),
		),
		vat: e.entity(EVat, { base: e.self("total"), rate: e.self("rate") }),
		longTags: raw([
			"filter",
			["ref", "tags"],
			["fn", ["tag"], ["gt", ["ref", "tag", "n"], 1]],
		]),
		tagSum: raw([
			"sum",
			["map", ["ref", "tags"], ["fn", ["tag"], ["ref", "tag", "n"]]],
		]),
		sizes: e.map(
			e.self("rows"),
			e.fn((row) => row(TSized, "size")),
		),
		quantities: raw([
			"map",
			["ref", "rows"],
			["fn", ["row"], ["ref", "row", "qty"]],
		]),
	},
	impls: [impl(TBig, { rows: e.self("bigRows") })],
});
const orders = kit({
	name: "orders",
	version: "1.0.0",
	functions: { gt, line },
	root: EOrder,
	entities: [EOrder, ERow, EInvoiceLine, EVat],
});

const start = () => {
	const program = orders.program({});
	const session = program.run([], { replica: "c1" });
	const root = session.root;
	const row = (qty: number, unitPrice = 0) => {
		const r = root.list("rows").add();
		r.member("qty").set(qty);
		r.member("unitPrice").set(unitPrice);
		return r;
	};
	return { program, session, root, row };
};
const ids = (list: { entries(): [string, unknown][] }) =>
	list.entries().map(([id]) => id);

describe("map and filter over a collection", () => {
	it("aggregates what a map gives for each row", () => {
		const { program, root, row } = start();
		expect(program.diagnostics).toEqual([]);
		row(2, 3);
		row(20, 1);
		expect(value(root.member("total").get())).toBe(26);
		expect(value(root.member("quantities").get())).toEqual([2, 20]);
		expect(value(root.member("sizes").get())).toEqual([20, 200]);
		expect(value(root.member("bigCount").get())).toBe(1);
	});

	it("runs a map's lambda again only for the row that changed", () => {
		const { session, root, row } = start();
		const rows = [row(1, 1), row(2, 1), row(3, 1)];
		root.member("total").subscribe(() => {});
		expect(value(root.member("total").get())).toBe(6);
		lineCalls = 0;
		rows[1]?.member("qty").set(5);
		expect(value(root.member("total").get())).toBe(9);
		expect(lineCalls).toBe(1);
		session.batch(() => row(1, 1));
		expect(value(root.member("total").get())).toBe(10);
		expect(lineCalls).toBe(2);
	});

	it("keeps the rows a filter keeps, at their own addresses", () => {
		const { root, row } = start();
		const a = row(2);
		const b = row(20);
		const big = root.list("bigRows");
		expect(ids(big)).toEqual([b.id]);
		expect(value(root.member("bigQty").get())).toBe(20);
		// A write to a filter's element goes to the row.
		must(big.at(0)).member("qty").set(300);
		expect(value(b.member("qty").get())).toBe(300);
		expect(ids(root.list("biggest"))).toEqual([b.id]);
		root.member("limit").set(1);
		expect(ids(big)).toEqual([a.id, b.id]);
		expect(must(big.at(0)).member("qty").isSet()).toBe(true);
	});

	it("tells a subscriber when the elements a filter keeps change", () => {
		const { root, row } = start();
		const a = row(2);
		let calls = 0;
		root.list("bigRows").subscribe(() => calls++);
		a.member("qty").set(50);
		expect(calls).toBe(1);
		expect(ids(root.list("bigRows"))).toEqual([a.id]);
	});

	it("builds an entity for each element, with the element's id", () => {
		const { root, row } = start();
		const a = row(2, 3);
		const lines = root.list("invoiceLines");
		const first = must(lines.at(0));
		expect(first.id).toBe(a.id);
		expect(value(first.member("amount").get())).toBe(6);
		expect(value(first.member("doubled").get())).toBe(12);
		expect(value(root.member("linesTotal").get())).toBe(12);
		// Writes go through the inverses to the row.
		first.member("qty").set(5);
		expect(value(a.member("qty").get())).toBe(5);
		expect(value(first.member("amount").get())).toBe(15);
		root.list("rows").remove(a.id);
		expect(ids(lines)).toEqual([]);
	});

	it("keeps a map's keys", () => {
		const { root } = start();
		root.map("rates").add("SE").member("qty").set(7);
		const lines = root.map("rateLines");
		expect(value(must(lines.get("SE")).member("amount").get())).toBe(7);
	});

	it("takes no ops at a derived address", () => {
		const { root, row } = start();
		row(20);
		expect(() => root.list("bigRows").add()).toThrow(
			"computed with map or filter",
		);
		expect(() => root.list("invoiceLines").add()).toThrow(
			"computed with map or filter",
		);
	});

	it("shows derived collections in the snapshot", () => {
		const { session, row } = start();
		const a = row(20, 2);
		const snapshot = session.snapshot() as Record<string, unknown>;
		expect(snapshot.bigRows).toEqual([{ id: a.id, qty: 20, unitPrice: 2 }]);
		expect(snapshot.invoiceLines).toEqual([
			{ id: a.id, amount: 40, qty: 20, doubled: 80 },
		]);
	});

	it("can stand for a trait's collection", () => {
		const { root, row } = start();
		row(20);
		row(1);
		expect(value(root.member("bigViaTrait").get())).toBe(20);
	});
});

describe("derived entities", () => {
	it("computes the entity's inputs from the holder", () => {
		const { root, row } = start();
		row(4, 10);
		expect(value(root.entity("vat").member("amount").get())).toBe(10);
	});

	it("writes through the input's expression", () => {
		const { root } = start();
		root.entity("vat").member("rate").set(10);
		expect(value(root.member("rate").get())).toBe(10);
		expect(root.entity("vat").member("base").writable()).toBe(false);
	});
});

describe("map and filter over a JSON array", () => {
	it("give another array, and an aggregate folds its items", () => {
		const { root } = start();
		expect(value(root.member("longTags").get())).toEqual([
			{ name: "b", n: 2 },
			{ name: "c", n: 3 },
		]);
		expect(value(root.member("tagSum").get())).toBe(6);
		root.member("tags").set([{ n: 5 }]);
		expect(value(root.member("tagSum").get())).toBe(5);
	});
});

describe("mistakes", () => {
	const ERoot = (derived: Record<string, unknown>) =>
		entity("root", {
			inputs: { rows: t.list(ERow), qty: t.number.initial(0) },
			derived: derived as Record<string, Ex<KnownN<number>>>,
		});
	const check = (derived: Record<string, unknown>) =>
		kit({
			name: "k",
			version: "1.0.0",
			functions: { gt },
			root: ERoot(derived),
			entities: [ERow, EInvoiceLine],
		}).program({}).diagnostics;

	it("warns when a parameter hides a member", () => {
		const found = check({
			x: [
				"sum",
				["map", ["ref", "rows"], ["fn", ["qty"], ["ref", "qty", "qty"]]],
			],
		});
		expect(found).toEqual([
			expect.objectContaining({ code: "scope.shadowed", severity: "warning" }),
		]);
	});

	it("reports a lambda outside map and filter, and an entity outside a derived member", () => {
		const found = check({
			a: ["fn", ["r"], 1],
			b: ["add", ["entity", "invoiceLine", {}], 1],
		});
		expect(found.map((d) => d.code)).toEqual(["lambda.where", "entity.where"]);
	});

	it("reports a filter whose lambda isn't true or false", () => {
		const found = check({
			x: [
				"count",
				["filter", ["ref", "rows"], ["fn", ["r"], ["ref", "r", "qty"]]],
			],
		});
		expect(found.map((d) => d.code)).toEqual(["call.types"]);
	});

	it("reports a map that builds entities from a JSON array", () => {
		const found = check({
			x: [
				"map",
				["ref", "qty"],
				["fn", ["r"], ["entity", "invoiceLine", { amount: 1, qty: 1 }]],
			],
		});
		expect(found.map((d) => d.code)).toEqual(["derived.source"]);
	});
});

describe("kit()", () => {
	const make =
		(derived: Record<string, Ex<unknown>>, entities: AnyEntity[] = [ERow]) =>
		() => {
			const root = entity("root", { inputs: { rows: t.list(ERow) }, derived });
			return kit({
				name: "k",
				version: "1.0.0",
				root,
				entities: [root, ...entities],
			});
		};
	const EConfigured = entity("configured", {
		config: { label: t.text },
		inputs: { amount: t.number.initial(0) },
	});
	const EHolder = entity("holder", { inputs: { rows: t.list(ERow) } });

	it("rejects e.entity of an entity with config, or with an entity input", () => {
		expect(
			make({ x: e.entity(EConfigured, { amount: 1 }) }, [ERow, EConfigured]),
		).toThrow("needs an entity without config");
		expect(
			make({ x: e.entity(EHolder, { rows: 1 }) }, [ERow, EHolder]),
		).toThrow(`whose inputs are all values, and "rows" isn't`);
	});

	it("rejects e.entity of an entity outside the kit, or missing an input", () => {
		expect(make({ x: e.entity(EVat, { base: 1, rate: 1 }) })).toThrow(
			"isn't in the kit's entities",
		);
		expect(
			make({ x: raw(["entity", "vat", { base: 1 }]) }, [ERow, EVat]),
		).toThrow(`needs an expression for "rate"`);
	});
});

describe("a Builder's lambda", () => {
	const ECharge = entity("charge", {
		config: { amount: t.expr(t.number), factor: t.number },
	});
	const ERoot = entity("root", {
		config: { charges: t.map(ECharge) },
		inputs: { rows: t.list(ERow) },
	});
	const builder = kit({
		name: "b",
		version: "1.0.0",
		root: ERoot,
		entities: [ERoot, ECharge, ERow],
	});

	it("reads the elements from outside, and its own instance inside the lambda", () => {
		const program = builder.program({
			config: {
				charges: {
					handling: {
						type: "charge",
						config: {
							factor: 2,
							amount: [
								"sum",
								[
									"map",
									["ref", "$parent", "rows"],
									[
										"fn",
										["r"],
										["mul", ["ref", "r", "qty"], ["ref", "factor"]],
									],
								],
							],
						},
					},
				},
			},
		});
		expect(program.diagnostics).toEqual([]);
		const session = program.run([], { replica: "c1" });
		session.root.list("rows").add().member("qty").set(3);
		session.root.list("rows").add().member("qty").set(4);
		const handling = session.at(["charges", "handling", "amount"]);
		expect(value(must(handling).get())).toBe(14);
	});
});
