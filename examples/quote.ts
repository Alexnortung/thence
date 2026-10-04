// The README's quick start, type-checked against the types in src/. Lines marked DIFFERS differ from the README.

import type { Decimal, EntityOf, Expr, Handle, NodeOf, Result } from "thence";
import { e, entity, fn, has, impl, kit, t, trait } from "thence";
import { useValue } from "thence/react";

declare const VAT_RATES: Record<string, number>;

// ---------- 1. Define a kit ----------

export const Money = t.decimal("Money", { scale: 2 });
export const Percent = t.decimal("Percent", { scale: 4 });

const vatRate = fn("vatRate", {
	params: { country: t.text },
	returns: Percent,
	impl: ({ country }) => VAT_RATES[country] ?? 0,
});

export const TPriced = trait("priced", { total: Money });

export const TConditional = trait(
	"conditional",
	{ when: t.bool, visible: t.bool },
	{
		visible: e.and(
			e.up("conditional", "visible", true),
			e.as("conditional", "when"),
		),
	},
);

const whenVisible = (total: Expr) =>
	e.if(e.as(TConditional, "visible"), total, 0);
const rollUp = (member: string) => ({
	total: whenVisible(e.sum(e.each(member, TPriced, "total"))),
});
const byConfig = { when: e.self("showWhen", true) };

export const EItem = entity("item", {
	inputs: { qty: t.int.initial(0), unitPrice: Money.initial("0.00") },
	impls: [impl(TPriced, { total: e.mul(e.self("qty"), e.self("unitPrice")) })],
});

export const EItems = entity("items", {
	config: { showWhen: t.expr(t.bool).optional() },
	inputs: { rows: t.list(EItem) },
	impls: [impl(TPriced, rollUp("rows")), impl(TConditional, byConfig)],
});

export const ECharge = entity("charge", {
	config: { formula: t.expr(Money), showWhen: t.expr(t.bool).optional() },
	impls: [
		impl(TPriced, { total: whenVisible(e.self("formula")) }),
		impl(TConditional, byConfig),
	],
});

export const ESection = entity("section", {
	config: {
		showWhen: t.expr(t.bool).optional(),
		lines: t.map(TPriced),
	},
	impls: [impl(TPriced, rollUp("lines")), impl(TConditional, byConfig)],
});

export const EQuote = entity("quote", {
	config: { sections: t.map(ESection) },
	inputs: { discountPercent: Percent.initial(0) },
	derived: {
		subtotal: e.sum(e.each("sections", TPriced, "total")),
		discountAmount: e.div(
			e.mul(e.self("subtotal"), e.self("discountPercent")),
			100,
		),
		total: e.sub(e.self("subtotal"), e.self("discountAmount")),
	},
});

export const quotes = kit({
	name: "quotes",
	version: "1.0.0",
	types: { Money, Percent },
	functions: { vatRate },
	root: EQuote,
	entities: [EQuote, ESection, EItems, EItem, ECharge],
	meta: t.meta<{ label?: string }>(), // DIFFERS: the README never types meta
});

// ---------- 2. Turn the Builder's work into a program ----------

const program = quotes.program({
	config: {
		sections: {
			hardware: {
				type: "section",
				meta: { label: "Hardware" },
				config: {
					lines: {
						items: { type: "items" },
						shipping: {
							type: "charge",
							meta: { label: "Shipping" },
							config: {
								formula: [
									"max",
									["mul", ["ref", "items", { as: "priced" }, "total"], 0.05],
									10,
								],
							},
						},
					},
				},
			},
			services: {
				type: "section",
				meta: { label: "Services" },
				config: {
					lines: {
						hours: { type: "items" },
					},
				},
			},
		},
	},
	inputs: { discountPercent: 5 },
});

// ---------- 3. Run a session ----------

declare function render(r: unknown): void;

const session = program.run();
const quote = session.root;
const total = quote.member("total");
total.get();
const stop = total.subscribe(() => render(total.get()));

const rows = session.at(["sections", "hardware", "lines", "items", "rows"])!; // DIFFERS: `!`, since at() may return undefined
const row = rows.add();
row.member("qty").set(3);
row.member("unitPrice").set("19.99");
row.as(TPriced).member("total").get();

quote.member("discountAmount").set("50.00");

// ---------- checks: what the README promises ----------

type Equal<A, B> =
	(<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2
		? true
		: false;
type Expect<T extends true> = T;

// values are typed from the kit, including derived ones
type _total = Expect<Equal<ReturnType<typeof total.get>, Result<Decimal>>>;
const qty = row.member("qty");
type _qty = Expect<Equal<ReturnType<typeof qty.get>, Result<number>>>;
type _rowType = Expect<Equal<typeof row.type, "item">>;

// set exists only where the README says a value is writable
quote.member("total").set("100.00"); // writable through discountAmount
quote.member("discountPercent").set(10);
// @ts-expect-error subtotal is a sum, so it isn't writable
quote.member("subtotal").set("1.00");
// @ts-expect-error a trait handle is read-only
row.as(TPriced).member("total").set("1.00");
// @ts-expect-error unknown member
row.member("qtty");
// @ts-expect-error total is a member of TPriced, not of EItem itself
row.member("total");
// @ts-expect-error EItem doesn't implement TConditional
row.as(TConditional);

// impls must be complete
// @ts-expect-error TPriced needs total
impl(TPriced, {});
impl(TConditional, { when: e.self("showWhen", true) }); // visible has a default

// inputs need a starting value
// @ts-expect-error a non-null input without .initial()
entity("bad", { inputs: { qty: t.int } });
entity("ok", { inputs: { qty: t.number.nullable() } });

// NodeOf rejects wrong Builder trees
const okNode: NodeOf<typeof quotes> = {
	type: "charge",
	config: { formula: ["ref", "x"] },
};
// @ts-expect-error a charge needs its formula
const badNode1: NodeOf<typeof quotes> = { type: "charge" };
// @ts-expect-error no such entity
const badNode2: NodeOf<typeof quotes> = { type: "chargee", config: {} };
// biome-ignore format: one line, so the @ts-expect-error below covers the whole call
// @ts-expect-error lines only holds entities that implement TPriced, and a quote doesn't
quotes.program({ config: { sections: { a: { type: "section", config: { lines: { q: { type: "quote", config: { sections: {} } } } } } } } });

// session.at is typed from the path, through a trait-typed map
type _rows = Expect<
	Equal<typeof rows, import("thence").ListHandle<typeof EItem, typeof quotes>>
>;
const section = session.at(["sections", "hardware"])!;
type _section = Expect<Equal<typeof section.type, "section">>;
const line = session.at(["sections", "hardware", "lines", "shipping"])!;
type _line = Expect<
	Equal<typeof line.type, "item" | "items" | "charge" | "section">
>; // any TPriced implementer

// ---------- 4. Render it (types only, no JSX) ----------

type EntityHandle = Handle<EntityOf<typeof quotes>, typeof quotes>;

function renderEntity(entity: EntityHandle): string {
	switch (entity.type) {
		case "item":
			entity.member("qty").set(1);
			return "item";
		case "items":
			return entity
				.list("rows")
				.entries()
				.map(([, r]) => renderEntity(r))
				.join();
		case "section":
			return (
				(entity.meta.label ?? "") +
				entity
					.map("lines")
					.entries()
					.map(([, l]) => renderEntity(l))
					.join()
			);
		case "charge":
			return totalText(entity.as(TPriced));
		case "quote":
			return "quote";
		default:
			return assertNever(entity);
	}
}
declare function assertNever(x: never): never;

function operate(entity: EntityHandle) {
	if (has(entity, TConditional)) {
		const r = entity.as(TConditional).member("visible").get();
		return r;
	}
	return undefined;
}

function totalText(priced: Handle<typeof TPriced, typeof quotes>): string {
	const r = priced.member("total").get();
	return r.ok ? r.value.toString() : r.error.message;
}

// A component reads a value with thence/react; it re-renders when the value changes.
export function QuoteTotal() {
	const r = useValue(quote, ["total"]);
	return r.ok ? r.value.toString() : r.error.message;
}

// ---------- 5. Verify on the server ----------
const replayed = quotes
	.program({ config: { sections: {} } })
	.run(session.ops());
replayed.snapshot();

void [stop, okNode, badNode1, badNode2, operate];
