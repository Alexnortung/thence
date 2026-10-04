// Traits and impls, trait-typed inputs, and what a formula can name.

import { describe, expect, it } from "vitest";
import { e, entity, fn, has, impl, kit, t, trait } from "..";
import type { Ex, KnownN } from "../kit";

/** A Builder's formula as raw JSON. */
const raw = <V = number>(json: unknown) => json as Ex<KnownN<V>>;
const value = (r: unknown) => (r as { value: unknown }).value;
const must = <T>(x: T | undefined): T => {
	if (x === undefined) throw new Error("expected a handle");
	return x;
};

const join = fn("join", {
	params: [{ a: t.text }, { b: t.text }],
	returns: t.text,
	impl: ({ a, b }) => `${a} ${b}`,
});
const firstWord = fn("firstWord", {
	params: [{ s: t.text }],
	returns: t.text,
	impl: ({ s }) => s.trim().split(/\s+/)[0] ?? "",
});

const TPerson = trait(
	"person",
	{ first: t.text, last: t.text, fullName: t.text },
	{
		fullName: e.call(join, {
			a: e.as("person", "first"),
			b: e.as("person", "last"),
		}),
	},
);
const TPriced = trait("priced", { total: t.number });

const EPersonField = entity("personField", {
	inputs: { first: t.text.initial(""), last: t.text.initial("") },
	impls: [impl(TPerson, { first: e.self("first"), last: e.self("last") })],
});
const EImportedPerson = entity("importedPerson", {
	inputs: { fullName: t.text.initial("") },
	impls: [
		impl(TPerson, {
			first: e.call(firstWord, { s: e.self("fullName") }),
			last: raw<string>(["text", "?"]),
			// overrides the default
			fullName: e.self("fullName"),
		}),
	],
});
const EItem = entity("item", {
	inputs: { qty: t.int.initial(1), price: t.number.initial(0) },
	derived: { lineTotal: e.mul(e.self("qty"), e.self("price")) },
	impls: [impl(TPriced, { total: e.self("lineTotal") })],
});
const ECharge = entity("charge", {
	config: { amount: t.expr(t.number) },
	impls: [impl(TPriced, { total: e.self("amount") })],
});
const TOrder = trait("order", {
	customer: TPerson,
	lines: t.list(TPriced),
	total: t.number,
});
const EOrder = entity("order", {
	config: {
		extras: t.map(TPriced),
		discount: t.expr(t.number).optional(),
	},
	inputs: {
		customer: TPerson.initial(EPersonField),
		rows: t.list(EItem),
	},
	derived: {
		subtotal: e.sum(e.each("rows", TPriced, "total")),
		extrasTotal: e.sum(e.each("extras", TPriced, "total")),
		greeting: raw<string>(["ref", "customer", { as: "person" }, "fullName"]),
		// through the trait's members that stand for the entity's own
		viaTrait: raw<string>([
			"ref",
			{ as: "order" },
			"customer",
			{ as: "person" },
			"first",
		]),
		viaTraitLines: raw([
			"sum",
			["ref", { as: "order" }, "lines", "$each", { as: "priced" }, "total"],
		]),
	},
	impls: [
		impl(TOrder, {
			customer: e.self("customer"),
			lines: e.self("rows"),
			total: e.add(e.self("subtotal"), e.self("extrasTotal")),
		}),
	],
});
const orders = kit({
	name: "orders",
	version: "1.0.0",
	functions: { join, firstWord },
	root: EOrder,
	entities: [EOrder, EPersonField, EImportedPerson, EItem, ECharge],
});

const tree = {
	config: {
		extras: {
			shipping: { type: "charge", config: { amount: 5 } },
			// a sibling: the other charge, by its key
			insurance: {
				type: "charge",
				config: {
					amount: ["mul", ["ref", "shipping", { as: "priced" }, "total"], 2],
				},
			},
		},
	},
} as const;

const start = (replica = "c1") => {
	const program = orders.program(tree);
	const session = program.run([], { replica });
	return { program, session, root: session.root };
};

describe("traits and impls", () => {
	it("reads a trait's members through as()", () => {
		const { program, root } = start();
		expect(program.diagnostics).toEqual([]);
		const row = root.list("rows").add();
		row.member("price").set(3);
		row.member("qty").set(2);
		expect(value(row.as(TPriced).member("total").get())).toBe(6);
		expect(value(root.as(TOrder).member("total").get())).toBe(6 + 5 + 10);
	});

	it("sums a trait's member over a map of different entities", () => {
		const { root } = start();
		expect(value(root.member("extrasTotal").get())).toBe(15);
		const charge = must(root.map("extras").get("insurance"));
		expect(value(charge.as(TPriced).member("total").get())).toBe(10);
	});

	it("uses a trait's default unless the impl gives the member", () => {
		const { root } = start();
		const person = root.entity("customer");
		if (person.type !== "personField") throw new Error("expected a field");
		person.member("first").set("Ada");
		person.member("last").set("Lovelace");
		expect(value(root.member("greeting").get())).toBe("Ada Lovelace");
	});

	it("follows a trait's members that stand for the entity's own", () => {
		const { root } = start();
		const person = root.as(TOrder).entity("customer");
		if (person.type !== "personField") throw new Error("expected a field");
		person.member("first").set("Ada");
		expect(value(root.member("viaTrait").get())).toBe("Ada");
		const row = root.list("rows").add();
		row.member("price").set(4);
		expect(value(root.member("viaTraitLines").get())).toBe(4);
	});

	it("narrows with has()", () => {
		const { root } = start();
		const person = root.entity("customer");
		expect(has(person, TPerson)).toBe(true);
		expect(has(person, TPriced)).toBe(false);
	});
});

describe("trait-typed inputs", () => {
	it("starts as the initial entity, and switches to a fresh instance", () => {
		const { session, root } = start();
		const customer = root.member("customer");
		expect(value(customer.get())).toEqual({ type: "personField" });
		const field = root.entity("customer");
		if (field.type !== "personField") throw new Error("expected a field");
		field.member("first").set("Ada");

		customer.set({ type: "importedPerson" });
		expect(value(customer.get())).toEqual({ type: "importedPerson" });
		const imported = root.entity("customer");
		if (imported.type !== "importedPerson") throw new Error("expected import");
		imported.member("fullName").set("Grace Hopper");
		expect(value(root.member("greeting").get())).toBe("Grace Hopper");
		expect(value(root.member("viaTrait").get())).toBe("Grace");

		// back again: a fresh instance, without the first name set earlier
		customer.set({ type: "personField" });
		expect(value(root.member("greeting").get())).toBe(" ");
		expect(session.snapshot()).toMatchObject({
			customer: { type: "personField", first: "", last: "" },
		});
		expect(session.at(["customer", "first"])).toBeDefined();
	});

	it("rejects an entity that doesn't implement the trait", () => {
		const { session } = start();
		expect(() =>
			session.apply({
				t: "set",
				at: ["customer"],
				v: { type: "item" },
				clock: "c2:1",
			}),
		).not.toThrow();
		expect(session.ops()).toEqual([]);
	});

	it("drops a value set before the switch that started the instance", () => {
		const a = start("a").session;
		const b = start("b").session;
		a.onApply((op) => b.apply(op));
		const field = a.root.entity("customer");
		if (field.type !== "personField") throw new Error("expected a field");
		const early = field.member("first").set("Ada");
		a.root.member("customer").set({ type: "importedPerson" });
		a.root.member("customer").set({ type: "personField" });
		// the early set arrives again, after both switches
		if (early.ok) b.apply(early.value);
		expect(value(b.root.member("greeting").get())).toBe(" ");
	});

	it("lets the Builder choose the initial entity", () => {
		const program = orders.program({
			...tree,
			inputs: { customer: { type: "importedPerson" } },
		});
		expect(program.diagnostics).toEqual([]);
		expect(value(program.run().root.member("customer").get())).toEqual({
			type: "importedPerson",
		});
		expect(
			orders.check({ ...tree, inputs: { customer: { type: "item" } } }),
		).toMatchObject([{ code: "node.type", field: "customer" }]);
	});
});

describe("scope", () => {
	const EField = entity("field", {
		config: { value: t.expr(t.number), weight: t.number.optional() },
	});
	const ESection = entity("section", {
		config: { fields: t.map(EField), rate: t.expr(t.number) },
		derived: { sum: e.sum(e.each("fields", "value")) },
	});
	const EForm = entity("form", {
		config: { sections: t.map(ESection), base: t.expr(t.number) },
	});
	const forms = kit({
		name: "forms",
		version: "1.0.0",
		root: EForm,
		entities: [EForm, ESection, EField],
	});
	const field = (expr: unknown) => ({ type: "field", config: { value: expr } });
	const form = (fields: Record<string, unknown>) => ({
		config: {
			base: 10,
			sections: {
				a: { type: "section", config: { rate: 2, fields } },
				b: { type: "section", config: { rate: 3, fields: {} } },
			},
		},
	});

	it("reads siblings, $parent and $root from a Builder's formula", () => {
		const program = forms.program(
			form({
				x: field(1),
				y: field(["add", ["ref", "x", "value"], 1]),
				z: field(["mul", ["ref", "$parent", "rate"], ["ref", "$root", "base"]]),
				w: field(["ref", "$parent", "b", "rate"]),
			}) as never,
		);
		expect(program.diagnostics).toEqual([]);
		const fields = must(program.run().root.map("sections").get("a")).map(
			"fields",
		);
		const read = (k: string) =>
			value(must(fields.get(k)).member("value").get());
		expect([read("x"), read("y"), read("z"), read("w")]).toEqual([1, 2, 20, 3]);
	});

	it("warns when an own member hides a sibling", () => {
		const diagnostics = forms.check(
			form({ weight: field(1), x: field(["ref", "weight"]) }),
		);
		expect(diagnostics).toMatchObject([
			{ code: "scope.shadowed", severity: "warning", field: "value" },
		]);
	});

	it("names nothing further out on its own", () => {
		expect(forms.check(form({ x: field(["ref", "base"]) }))).toMatchObject([
			{ code: "ref.unknown", at: ["sections", "a", "fields", "x"] },
		]);
	});

	it("keeps your own expressions to the entity", () => {
		const EBad = entity("bad", {
			config: { x: t.expr(t.number) },
			derived: { up: raw(["ref", "$parent", "x"]) },
		});
		const bad = kit({
			name: "bad",
			version: "1",
			root: EBad,
			entities: [EBad],
		});
		expect(bad.check({ config: { x: 1 } })).toMatchObject([
			{ code: "scope.isolated", field: "up" },
		]);
	});
});

describe("kit()", () => {
	const make =
		(...entities: ReturnType<typeof entity>[]) =>
		() =>
			kit({
				name: "k",
				version: "1",
				root: entities[0] as ReturnType<typeof entity>,
				entities,
			});

	it("rejects an impl that leaves out a member", () => {
		const bad = entity("bad", {
			impls: [impl(TPriced, {} as { total: never })],
		});
		expect(make(bad)).toThrow(`its impl of priced needs "total"`);
	});

	it("rejects a member the trait doesn't have", () => {
		const bad = entity("bad", {
			impls: [
				impl(TPriced, { total: raw(1), extra: raw(2) } as unknown as {
					total: never;
				}),
			],
		});
		expect(make(bad)).toThrow(`priced has no member "extra"`);
	});

	it("rejects implementing a trait twice", () => {
		const bad = entity("bad", {
			impls: [
				impl(TPriced, { total: raw(1) }),
				impl(TPriced, { total: raw(2) }),
			],
		});
		expect(make(bad)).toThrow("it implements priced twice");
	});

	it("rejects a name declared twice, or with a colon", () => {
		const twice = entity("twice", {
			inputs: { x: t.number.initial(0) },
			derived: { x: e.self("x") },
		});
		expect(make(twice)).toThrow(`"x" is declared twice`);
		const colon = entity("colon", { inputs: { "as:x": t.number.initial(0) } });
		expect(make(colon)).toThrow(`can't have a ":"`);
	});

	it("rejects a trait member holding an entity that isn't one of the entity's own", () => {
		const bad = entity("bad", {
			impls: [
				impl(TOrder, {
					customer: e.self("nobody"),
					lines: e.self("nobody"),
					total: raw(0),
				}),
			],
		});
		expect(make(bad)).toThrow("order.customer holds an entity");
	});

	it("rejects a trait member's entity or collection holding entities its type doesn't allow", () => {
		const ENote = entity("note", { inputs: { text: t.text.initial("") } });
		const lines = entity("lines", {
			inputs: { customer: TPerson.initial(EPersonField), rows: t.list(ENote) },
			impls: [
				impl(TOrder, {
					customer: e.self("customer"),
					lines: e.self("rows") as never,
					total: raw(0),
				}),
			],
		});
		expect(make(lines, ENote, EPersonField)).toThrow(
			`"rows" may hold an entity that order.lines doesn't allow`,
		);
		const customer = entity("customer", {
			inputs: { customer: ENote, rows: t.list(EItem) },
			impls: [
				impl(TOrder, {
					customer: e.self("customer") as never,
					lines: e.self("rows"),
					total: raw(0),
				}),
			],
		});
		expect(make(customer, ENote, EItem)).toThrow(
			`"customer" may hold an entity that order.customer doesn't allow`,
		);
		const mixed = entity("mixed", {
			inputs: {
				customer: TPerson.initial(EPersonField),
				rows: t.list(t.oneOf(EItem, ENote)),
			},
			impls: [
				impl(TOrder, {
					customer: e.self("customer"),
					lines: e.self("rows") as never,
					total: raw(0),
				}),
			],
		});
		expect(make(mixed, ENote, EItem, EPersonField)).toThrow(
			`"rows" may hold an entity that order.lines doesn't allow`,
		);
	});

	it("accepts entities and traits that fit a trait member", () => {
		const ok = entity("ok", {
			inputs: {
				customer: EPersonField,
				rows: t.list(t.oneOf(EItem, ECharge, TPriced)),
			},
			impls: [
				impl(TOrder, {
					customer: e.self("customer"),
					lines: e.self("rows"),
					total: raw(0),
				}),
			],
		});
		expect(make(ok, EPersonField, EItem, ECharge)).not.toThrow();
	});
});
