// Diagnostics: where a mistake is, what the Builder supplied, and what it breaks.

import { describe, expect, it } from "vitest";
import { e, entity, kit, t } from "..";

const ECharge = entity("charge", {
	config: { amount: t.expr(t.number), note: t.expr(t.number) },
	derived: { doubled: e.mul(e.self("amount"), 2) },
});
const EQuote = entity("quote", {
	config: { charges: t.map(ECharge) },
	derived: { total: e.sum(e.each("charges", "amount")) },
});
const quotes = kit({
	name: "quotes",
	version: "1.0.0",
	root: EQuote,
	entities: [EQuote, ECharge],
});

const charge = (amount: unknown, meta?: unknown) => ({
	type: "charge",
	config: { amount, note: 0 },
	...(meta === undefined ? {} : { meta }),
});
const program = (charges: Record<string, unknown>) =>
	quotes.program({ config: { charges } } as never);

describe("diagnostics", () => {
	it("take an error expression anywhere, and hand back its data", () => {
		const p = program({
			shipping: charge([
				"add",
				1,
				["error", { message: "unexpected )", data: { range: [4, 5] } }],
			]),
		});
		expect(p.diagnostics).toEqual([
			{
				code: "expr.error",
				message: "unexpected )",
				at: ["charges", "shipping"],
				field: "amount",
				exprPath: [2],
				data: { range: [4, 5] },
			},
		]);
	});

	it("say where in the expression the mistake is", () => {
		const p = program({
			shipping: charge(["mul", 2, ["add", 1, ["ref", "nope"]]]),
		});
		expect(p.diagnostics).toMatchObject([
			{ code: "ref.unknown", field: "amount", exprPath: [2, 2] },
		]);
	});

	it("hand back the node's meta", () => {
		const p = program({
			shipping: charge(["ref", "nope"], { label: "Shipping" }),
			bad: { type: "nothing", meta: { label: "Bad" } },
		});
		expect(p.diagnostics).toMatchObject([
			{ code: "node.unknown", at: ["charges", "bad"], meta: { label: "Bad" } },
			{
				code: "ref.unknown",
				at: ["charges", "shipping"],
				meta: { label: "Shipping" },
			},
		]);
	});

	it("break only the values that read the broken field", () => {
		const p = program({
			shipping: charge(["error", { message: "bad" }]),
			handling: charge(3),
		});
		const root = p.run().root;
		const shipping = root.map("charges").get("shipping");
		const handling = root.map("charges").get("handling");
		expect(shipping?.member("doubled").get()).toMatchObject({
			ok: false,
			error: { code: "expr.error" },
		});
		expect(shipping?.member("note").get()).toEqual({ ok: true, value: 0 });
		expect(handling?.member("doubled").get()).toEqual({ ok: true, value: 6 });
		expect(root.member("total").get()).toMatchObject({
			ok: false,
			error: { code: "expr.error", at: ["total"] },
		});
	});
});
