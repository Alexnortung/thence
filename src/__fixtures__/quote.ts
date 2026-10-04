// A small kit for the type tests: items and charges are priced, a quote holds both.

import { e, entity, fn, impl, kit, t, trait } from "..";

const Money = t.decimal("Money", { scale: 2 });

/** Two parameters, and an inverse only for `value`. */
const scale = fn("scale", {
	params: { value: t.number, factor: t.number },
	returns: t.number,
	impl: ({ value, factor }) => value * factor,
	inverse: { value: ({ result, factor }) => result / factor },
});

export const TPriced = trait("priced", { total: Money });
export const TNamed = trait("named", { name: t.text });

export const EItem = entity("item", {
	inputs: {
		name: t.text.initial(""),
		qty: t.int.initial(1),
		price: Money.initial(0),
	},
	derived: {
		lineTotal: e.mul(e.self("price"), e.self("qty")),
		doubled: e.mul(e.self("qty"), 2),
		tripled: e.mul(3, e.self("qty")),
		scaled: e.call(scale, { value: e.self("qty"), factor: 2 }),
		scaledBy: e.call(scale, { value: 2, factor: e.self("qty") }),
	},
	impls: [
		impl(TPriced, { total: e.self("lineTotal") }),
		impl(TNamed, { name: e.self("name") }),
	],
});

export const ECharge = entity("charge", {
	config: { amount: t.expr(Money), note: t.text.optional() },
	impls: [impl(TPriced, { total: e.self("amount") })],
});

export const ENote = entity("note", {
	inputs: { text: t.text.initial("") },
	impls: [impl(TNamed, { name: e.self("text") })],
});

export const EQuote = entity("quote", {
	config: {
		lines: t.map(TPriced),
		named: t.map(t.all(TPriced, TNamed)),
		extras: t.map(t.oneOf(ECharge, ENote)),
	},
	inputs: {
		rows: t.list(EItem),
		discount: Money.initial(0),
		customer: t.text.nullable(),
	},
	derived: {
		subtotal: e.sum(e.each("rows", TPriced, "total")),
		total: e.sub(e.self("subtotal"), e.self("discount")),
	},
});

const quotes = kit({
	name: "quotes",
	version: "1",
	root: EQuote,
	entities: [EQuote, EItem, ECharge, ENote],
	functions: { scale },
});

export type Quotes = typeof quotes;
