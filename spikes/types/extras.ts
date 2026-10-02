// Other README promises: inverses on your own functions, derived entities, trait-typed inputs, the add builder.

import type { Handle, PlacementOf } from "thence";
import { e, entity, fn, impl, kit, std, t, trait } from "thence";
import { type EItem, Money, Percent, quotes, TPriced } from "./quote";

type Equal<A, B> =
	(<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2
		? true
		: false;
type Expect<T extends true> = T;

// ---------- your own functions: an expression body, or impl with an inverse ----------
// The body is an expression, so the inverse for celsius is derived from it.
const toFahrenheit = fn("toFahrenheit", {
	params: { celsius: t.number },
	returns: t.number,
	body: ({ celsius }) => e.add(e.div(e.mul(celsius, 9), 5), 32),
});
// x appears twice, so the body can't be inverted through it.
const square = fn("square", {
	params: { x: t.number },
	returns: t.number,
	body: ({ x }) => e.mul(x, x),
});
// A lookup can't be an expression, so it stays in TypeScript, with its own inverse.
const fromCode = fn("fromCode", {
	params: { code: t.number },
	returns: t.text,
	impl: ({ code }) => String(code),
	inverse: { code: ({ result }) => Number(result) },
});
// biome-ignore format: one line, so the @ts-expect-error below covers the whole call
// @ts-expect-error the body is a number, but returns says text
fn("wrongType", { params: { x: t.number }, returns: t.text, body: ({ x }) => e.mul(x, 2) });
// biome-ignore format: one line, so the @ts-expect-error below covers the whole call
// @ts-expect-error a body never comes with an impl
fn("both", { params: { x: t.number }, returns: t.number, body: ({ x }) => e.mul(x, 2), impl: ({ x }: { x: number }) => x * 2 });
const noInverse = fn("double", {
	params: { x: t.number },
	returns: t.number,
	impl: ({ x }) => x * 2,
});

const EThermo = entity("thermo", {
	inputs: {
		celsius: t.number.initial(20),
		a: t.number.initial(1),
		b: t.number.initial(2),
	},
	derived: {
		fahrenheit: e.call(toFahrenheit, e.self("celsius")),
		doubled: e.call(noInverse, e.self("celsius")),
		squared: e.call(square, e.self("celsius")),
		code: e.call(fromCode, e.self("celsius")),
		product: e.mul(e.self("a"), e.self("b")), // two inputs: not writable
		shifted: e.add(e.self("fahrenheit"), 1), // writable through fahrenheit
	},
});

// ---------- derived entities and trait-typed inputs ----------
const vatRate = fn("vatRate", {
	params: { country: t.text },
	returns: Percent,
	impl: () => 0,
});
const EVat = entity("vat", {
	inputs: { base: Money.initial("0.00"), rate: Percent.initial(0) },
	derived: { amount: e.div(e.mul(e.self("base"), e.self("rate")), 100) },
});
const TPerson = trait("person", {
	first: t.text,
	last: t.text,
	fullName: t.text,
});
const EPersonField = entity("personField", {
	inputs: { first: t.text.initial(""), last: t.text.initial("") },
	impls: [
		impl(TPerson, {
			first: e.self("first"),
			last: e.self("last"),
			fullName: e.concat(e.self("first"), e.text(" "), e.self("last")),
		}),
	],
});
const EImportedPerson = entity("importedPerson", {
	inputs: { fullName: t.text.initial("") },
	impls: [
		impl(TPerson, {
			first: e.self("fullName"),
			last: e.self("fullName"),
			fullName: e.self("fullName"),
		}),
	],
});
const EOrder = entity("order", {
	inputs: {
		customer: TPerson.initial(EPersonField),
		total: Money.initial("0.00"),
		country: t.text.initial("SE"),
	},
	derived: {
		vat: e.entity(EVat, {
			base: e.self("total"),
			rate: e.call(vatRate, e.self("country")),
		}),
	},
});
const orders = kit({
	name: "orders",
	version: "1.0.0",
	functions: { ...std, toFahrenheit, vatRate },
	root: EOrder,
	entities: [EOrder, EPersonField, EImportedPerson, EVat, EThermo],
});

declare const thermo: Handle<typeof EThermo, typeof orders>;
thermo.member("fahrenheit").set(212);
thermo.member("code").set("7");
// @ts-expect-error x appears twice in square's body
thermo.member("squared").set(4);
thermo.member("shifted").set(213);
// @ts-expect-error no inverse
thermo.member("doubled").set(4);
// @ts-expect-error two writable arguments
thermo.member("product").set(4);
const fahrenheit = thermo.member("fahrenheit");
type _f = Expect<
	Equal<ReturnType<typeof fahrenheit.get>, import("thence").Result<number>>
>;

const order = orders.program({}).run().root;
const vat = order.entity("vat");
type _vat = Expect<Equal<typeof vat.type, "vat">>;
vat.member("amount").get();
const customer = order.entity("customer");
type _customer = Expect<
	Equal<typeof customer.type, "personField" | "importedPerson">
>;
customer.as(TPerson).member("first").get();

// ---------- Handle without naming the kit, through registration ----------
declare module "thence" {
	interface Register {
		kit: typeof quotes;
	}
}
function rowTotal(row: Handle<typeof EItem>) {
	// the README's spelling: no kit argument
	return row.as(TPriced).member("total").get();
}
void rowTotal;

// ---------- the add builder ----------
type MyNode = {
	slot: string;
	name: string;
	label: string;
	entity: PlacementOf<typeof quotes>;
	children?: MyNode[];
};
export const toProgram = (doc: { children: MyNode[] }) =>
	quotes.program((p) => {
		const place = (parent: typeof p.root, node: MyNode) => {
			const placed = parent.add(node.slot, node.name, node.entity, {
				meta: { label: node.label },
			});
			for (const child of node.children ?? []) place(placed, child);
		};
		for (const child of doc.children) place(p.root, child);
	});
