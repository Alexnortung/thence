// session.explain: how a value was computed, down to the inputs and the ops that set them.

import { describe, expect, it } from "vitest";
import { e, entity, kit, t } from "..";
import type { Ex, KnownN } from "../kit";

const ERow = entity("row", {
	inputs: { qty: t.int.initial(1), price: t.number.initial(0) },
	derived: { amount: e.mul(e.self("qty"), e.self("price")) },
});
const EQuote = entity("quote", {
	inputs: { rows: t.list(ERow), discount: t.number.initial(0) },
	derived: {
		subtotal: e.sum(e.each("rows", "amount")),
		total: e.sub(e.self("subtotal"), e.self("discount")),
		first: ["ref", "rows", { at: 0 }, "amount"] as unknown as Ex<
			KnownN<number>
		>,
	},
});
const quotes = kit({
	name: "quotes",
	version: "1.0.0",
	root: EQuote,
	entities: [EQuote, ERow],
});

describe("session.explain", () => {
	it("traces a value back to the inputs and the ops that set them", () => {
		const session = quotes.program({}).run([], { replica: "c1" });
		const root = session.root;
		const row = root.list("rows").add();
		row.member("price").set(10);
		row.member("qty").set(3);
		root.member("discount").set(5);

		expect(session.explain(root.member("total"))).toEqual({
			path: ["total"],
			value: 25,
			expr: ["sub", ["ref", "subtotal"], ["ref", "discount"]],
			reads: [
				{
					path: ["subtotal"],
					value: 30,
					expr: ["sum", ["ref", "rows", "$each", "amount"]],
					reads: [
						{
							path: ["rows", "$each", "amount"],
							value: 30,
							reads: [
								{
									path: ["rows", row.id, "amount"],
									value: 30,
									expr: ["mul", ["ref", "qty"], ["ref", "price"]],
									reads: [
										{
											path: ["rows", row.id, "qty"],
											value: 3,
											source: "input",
											op: 2,
										},
										{
											path: ["rows", row.id, "price"],
											value: 10,
											source: "input",
											op: 1,
										},
									].map((r) => ({ ...r, reads: [] })),
								},
							],
						},
					],
				},
				{ path: ["discount"], value: 5, source: "input", op: 3, reads: [] },
			],
		});
	});

	it("follows a lookup to what it found, and leaves out an initial value's op", () => {
		const session = quotes.program({}).run();
		const root = session.root;
		expect(session.explain(root.member("first")).reads).toEqual([
			{ path: ["rows", "{at:0}", "amount"], value: null, reads: [] },
		]);
		const row = root.list("rows").add();
		expect(session.explain(root.member("first")).reads[0]).toMatchObject({
			path: ["rows", row.id, "amount"],
			value: 0,
			reads: [
				{ path: ["rows", row.id, "qty"], value: 1, source: "input", reads: [] },
				{
					path: ["rows", row.id, "price"],
					value: 0,
					source: "input",
					reads: [],
				},
			],
		});
	});

	it("explains an input, and takes only this session's member handles", () => {
		const session = quotes.program({}).run();
		const discount = session.root.member("discount");
		expect(session.explain(discount)).toEqual({
			path: ["discount"],
			value: 0,
			source: "input",
			reads: [],
		});
		expect(() => session.explain({} as never)).toThrow("member handle");
	});
});
