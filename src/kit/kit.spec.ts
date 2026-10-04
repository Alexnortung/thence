import { describe, expect, it } from "vitest";
import { e, entity, fn, impl, t, trait } from ".";

describe("t", () => {
	it("builds value types as plain data", () => {
		expect(t.number.spec).toEqual({
			base: "number",
			nullable: false,
			checks: [],
		});
		expect(t.text.nullable().spec.nullable).toBe(true);
		expect(t.decimal("Money", { scale: 2 }).spec).toMatchObject({
			base: "decimal",
			name: "Money",
			scale: 2,
		});
		expect(
			t.number("Temperature", { converge: { abs: 1e-9 } }).spec,
		).toMatchObject({
			name: "Temperature",
			converge: { abs: 1e-9 },
		});
		expect(t.enum("Unit", ["kg", "g"]).values).toEqual(["kg", "g"]);
		expect(t.enum.from("options").spec.from).toBe("options");
	});

	it("keeps an input's initial value and its type", () => {
		const qty = t.int.initial(1);
		expect(qty.value).toBe(1);
		expect(qty.type.spec.base).toBe("int");
		const schema = { "~standard": {} };
		expect(qty.check(schema).type.spec.checks).toEqual([schema]);
	});

	it("wraps member types", () => {
		const row = entity("row", {});
		expect(t.list(row)).toEqual({ "~kind": "list", "~of": row });
		expect(t.map(row)["~kind"]).toBe("map");
		expect(t.expr(t.number).optional()["~kind"]).toBe("optional");
		expect(t.oneOf(row)["~of"]).toEqual([row]);
		expect(t.enum.def()["~kind"]).toBe("enumDef");
	});
});

describe("e", () => {
	it("builds the Builder's JSON", () => {
		const TPriced = trait("priced", { total: t.number });
		expect(e.self("qty")).toEqual(["ref", "qty"]);
		expect(e.mul(e.self("qty"), 2)).toEqual(["mul", ["ref", "qty"], 2]);
		expect(e.each("rows", TPriced, "total")).toEqual([
			"ref",
			"rows",
			"$each",
			{ as: "priced" },
			"total",
		]);
		expect(e.each("rows", "qty")).toEqual(["ref", "rows", "$each", "qty"]);
		expect(e.as(TPriced, "total")).toEqual(["ref", { as: "priced" }, "total"]);
		expect(e.text("a")).toEqual(["text", "a"]);
	});

	it("calls your own functions with named arguments", () => {
		const scale = fn("scale", {
			params: [{ value: t.number }, { factor: t.number }],
			returns: t.number,
			impl: ({ value, factor }) => value * factor,
		});
		expect(e.call(scale, { value: e.self("qty"), factor: 2 })).toEqual([
			"scale",
			{ value: ["ref", "qty"], factor: 2 },
		]);
	});

	it("says which helpers aren't there yet", () => {
		expect(() => e.up("conditional", "visible", true)).toThrow(
			"thence: e.up isn't implemented yet",
		);
	});
});

describe("traits and entities", () => {
	it("are plain data", () => {
		const TPriced = trait("priced", { total: t.number });
		const EItem = entity("item", {
			inputs: { price: t.number.initial(0) },
			impls: [impl(TPriced, { total: e.self("price") })],
		});
		expect(EItem.name).toBe("item");
		expect(EItem["~def"].impls[0]?.body).toEqual({ total: ["ref", "price"] });
		expect(TPriced.initial(EItem)["~entity"]).toBe(EItem);
	});
});

describe("fn.aggregate", () => {
	it("gives each fold the initial accumulator", () => {
		const count = fn.aggregate({
			init: 0,
			add: (n: number) => n + 1,
			remove: (n: number) => n - 1,
			result: (n: number) => n,
		});
		expect(count.result(count.add(count.init(), 1))).toBe(1);
	});
});
