// Your data document: an ordinary derived value built with record, entry and
// merge, which formulas read by path without a cycle.

import { describe, expect, it } from "vitest";
import { e, entity, type Handle, impl, kit, std, t, trait } from "..";

const Money = t.decimal("Money", { scale: 2 });
const TData = trait("data", { data: t.json });
const stored = (value: Parameters<typeof e.record>[0]) =>
	impl(TData, { data: e.entry(e.key(), e.record(value)) });

const EField = entity("field", {
	inputs: { value: t.number.initial(0) },
	impls: [stored({ value: e.self("value") })],
});
const ECalc = entity("calc", {
	config: { formula: t.expr(t.number.nullable()) },
	derived: { value: e.self("formula") },
	impls: [stored({ value: e.self("value") })],
});
const ESection = entity("section", {
	config: { fields: t.map(TData) },
	impls: [impl(TData, { data: e.merge(e.each("fields", TData, "data")) })],
});
const ERow = entity("row", {
	inputs: { qty: t.number.initial(1), price: Money.initial("19.99") },
	impls: [
		impl(TData, {
			data: e.record({
				qty: e.record({ value: e.self("qty") }),
				price: e.record({ value: e.self("price") }),
			}),
		}),
	],
});
const EGroup = entity("group", {
	inputs: { rows: t.list(ERow) },
	impls: [
		impl(TData, { data: e.entry(e.key(), e.each("rows", TData, "data")) }),
	],
});
const EForm = entity("form", {
	config: { fields: t.map(TData), extra: t.expr(t.json).optional() },
	derived: { data: e.merge(e.each("fields", TData, "data")) },
});
const forms = kit({
	name: "forms",
	version: "1",
	root: EForm,
	entities: [EForm, ESection, EField, ECalc, EGroup, ERow],
	functions: { ...std },
});

const field = { type: "field" };
const calc = (formula: unknown) => ({ type: "calc", config: { formula } });
const form = (contact: Record<string, unknown>, more = {}) => ({
	config: {
		fields: {
			contact: { type: "section", config: { fields: contact } },
			lineItems: { type: "group" },
		},
		...more,
	},
});
const total = calc([
	"add",
	["ref", "$root", "data", "deposit", "value"],
	["sum", ["ref", "$root", "data", "lineItems", "$each", "qty", "value"]],
]);

describe("the data document", () => {
	it("is built by your entities, without the sections", () => {
		const program = forms.program(form({ deposit: field, total }) as never);
		expect(program.diagnostics).toEqual([]);
		const session = program.run();
		const deposit = ["fields", "contact", "fields", "deposit", "value"];
		(session.at(deposit) as unknown as { set(v: number): unknown }).set(5);
		const rows = session.root.map("fields").get("lineItems") as Handle<
			typeof EGroup,
			typeof forms
		>;
		rows.list("rows").add().member("qty").set(2);
		rows.list("rows").add();
		expect(session.root.member("data").get()).toEqual({
			ok: true,
			value: {
				deposit: { value: 5 },
				total: { value: 8 },
				lineItems: [
					{ qty: { value: 2 }, price: { value: "19.99" } },
					{ qty: { value: 1 }, price: { value: "19.99" } },
				],
			},
		});
	});

	it("is read by path, depending only on what the path reaches", () => {
		const program = forms.program(form({ deposit: field, total }) as never);
		expect(
			program.dependencies(["fields", "contact", "fields", "total", "formula"]),
		).toEqual([
			["fields", "contact", "fields", "deposit", "value"],
			["fields", "lineItems", "rows", "$each", "qty"],
		]);
	});

	it("reads null where the document has nothing", () => {
		const program = forms.program(
			form({
				missing: calc(["ref", "$root", "data", "nope", "value"]),
			}) as never,
		);
		expect(program.diagnostics).toEqual([]);
		const { root } = program.run();
		expect(root.member("data").get()).toEqual({
			ok: true,
			value: { missing: { value: null }, lineItems: [] },
		});
	});

	it("reports a key two parts store", () => {
		const program = forms.program(
			form(
				{ deposit: field, reader: calc(["ref", "$root", "data", "lineItems"]) },
				{},
			) as never,
		);
		expect(program.diagnostics.map((d) => d.code)).toEqual(["ref.list"]);
		const twice = forms.program({
			config: {
				fields: {
					a: { type: "section", config: { fields: { x: field } } },
					b: {
						type: "section",
						config: {
							fields: {
								x: field,
								y: calc(["ref", "$root", "data", "x", "value"]),
							},
						},
					},
				},
			},
		} as never);
		expect(twice.diagnostics.map((d) => d.code)).toEqual(["merge.duplicate"]);
		expect(twice.run().root.member("data").get()).toMatchObject({
			ok: false,
			error: { code: "merge.duplicate" },
		});
	});

	it("reads a value it can't follow whole", () => {
		const program = forms.program(
			form(
				{ fromExtra: calc(["ref", "$root", "extra", "a", "b"]) },
				{ extra: ["record", { a: ["record", { b: 3 }] }] },
			) as never,
		);
		expect(program.diagnostics).toEqual([]);
		const value = program
			.run()
			.at(["fields", "contact", "fields", "fromExtra", "value"]);
		expect(value?.get()).toEqual({ ok: true, value: 3 });
	});
});
