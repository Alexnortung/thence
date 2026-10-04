// The README's form builder, type-checked against the types in src/.

import type { Handle, Json, NodeOf, Result } from "thence";
import { e, entity, has, impl, kit, t, trait } from "thence";
import { z } from "zod";

const TConditional = trait(
	"conditional",
	{ when: t.bool, visible: t.bool },
	{
		visible: e.and(
			e.up("conditional", "visible", true),
			e.as("conditional", "when"),
		),
	},
);

const TValidated = trait("validated", { error: t.text.nullable() });
const TField = trait("field", {});

const field = {
	showWhen: t.expr(t.bool).optional(),
	errorWhen: t.expr(t.bool).optional(),
	errorMessage: t.text.optional(),
};

const visible = impl(TConditional, { when: e.self("showWhen", true) });
const validated = impl(TValidated, {
	error: e.if(
		e.self("errorWhen", false),
		e.self("errorMessage", "Invalid"),
		null,
	),
});

const TData = trait("data", { data: t.json });
const stored = impl(TData, {
	data: e.entry(e.key(), e.record({ value: e.self("value") })),
});
const fieldData = e.merge(e.each("fields", TData, "data"));
const merged = impl(TData, { data: fieldData });
const nestable = impl(TData, {
	data: e.if(e.self("nest", false), e.entry(e.key(), fieldData), fieldData),
});

const fieldImpls = [impl(TField, {}), visible, validated, stored];

const ETextField = entity("text", {
	config: field,
	inputs: { value: t.text.initial("") },
	impls: fieldImpls,
});
const ENumberField = entity("number", {
	config: field,
	inputs: { value: t.number.nullable() },
	impls: fieldImpls,
});
const EChoice = entity("choice", {
	config: { ...field, options: t.enum.def() },
	inputs: { value: t.enum.from("options").nullable() },
	impls: fieldImpls,
});
const ECalcField = entity("calc", {
	config: { ...field, formula: t.expr(t.number) },
	derived: { value: e.self("formula") },
	impls: fieldImpls,
});
const ETextCalc = entity("textCalc", {
	config: { ...field, formula: t.expr(t.text) },
	derived: { value: e.self("formula") },
	impls: fieldImpls,
});

// what a form, a section or a row may hold, by name; a function, since it refers to entities defined below
const content = () =>
	t.map(t.oneOf(TField, EGroup, EKeyedGroup, ETable, ESection));

const ERow = entity("row", {
	config: { fields: content, showWhen: t.expr(t.bool).optional() },
	impls: [merged, visible],
});
const EGroup = entity("group", {
	config: field,
	inputs: { rows: t.list(ERow) },
	impls: [
		visible,
		impl(TData, { data: e.entry(e.key(), e.each("rows", TData, "data")) }),
	],
});
const EKeyedGroup = entity("keyedGroup", {
	config: field,
	inputs: { rows: t.map(ERow) },
	impls: [
		visible,
		impl(TData, { data: e.entry(e.key(), e.keyed("rows", TData, "data")) }),
	],
});
const ETable = entity("table", {
	config: { ...field, totals: content },
	inputs: { rows: t.list(ERow) },
	// hidden rows don't count in the totals (lambdas aren't typed yet, so the row is untyped here)
	derived: {
		shown: e.filter(
			e.self("rows"),
			e.fn((row) => row("visible")),
		),
	},
	impls: [
		visible,
		validated,
		impl(TData, {
			data: e.entry(
				e.key(),
				e.record({
					rows: e.each("rows", TData, "data"),
					totals: e.merge(e.each("totals", TData, "data")),
				}),
			),
		}),
	],
});
const ESection = entity("section", {
	config: { ...field, fields: content, nest: t.bool.optional() },
	impls: [visible, nestable],
});
// The data document is an ordinary derived member of the root: Builder formulas read
// ["ref", "$root", "data", …] and the app saves session.root.member("data").get().
const EForm = entity("form", {
	config: { fields: content },
	derived: { data: fieldData },
	impls: [merged],
});

export const forms = kit({
	name: "forms",
	version: "1.0.0",
	root: EForm,
	entities: [
		EForm,
		ESection,
		ERow,
		EGroup,
		EKeyedGroup,
		ETable,
		ETextField,
		ENumberField,
		EChoice,
		ECalcField,
		ETextCalc,
	],
	meta: z.object({ label: z.string().optional() }),
});

const program = forms.program({
	config: {
		fields: {
			customerType: { type: "text", meta: { label: "Customer type" } },
			company: {
				type: "section",
				meta: { label: "Company" },
				config: {
					showWhen: [
						"eq",
						["ref", "customerType", "value"],
						["text", "business"],
					],
					fields: {
						vatId: {
							type: "text",
							meta: { label: "VAT ID" },
							config: {
								errorWhen: ["eq", ["len", ["ref", "value"]], 0],
								errorMessage: "Required for businesses",
							},
						},
					},
				},
			},
			lineItems: {
				type: "group",
				meta: { label: "Line items" },
				inputs: {
					rows: {
						template: {
							config: {
								fields: {
									product: { type: "text", meta: { label: "Product" } },
									lineTotal: { type: "number", meta: { label: "Total" } },
								},
							},
						},
					},
				},
			},
			renting: { type: "number", meta: { label: "Monthly rent" } },
			// The table user story: columns are the fields of the row template, rows start
			// from the Builder's initial rows, and the totals sum the shown rows.
			budget: {
				type: "table",
				meta: { label: "Budget" },
				config: {
					errorWhen: ["eq", ["ref", "rows", { id: "rent" }], null], // "locked" is a rule
					errorMessage: "Keep the Rent row",
					totals: {
						q1: {
							type: "calc",
							config: {
								formula: [
									"sum",
									["ref", "$parent", "shown", "$each", "fields", "q1", "value"],
								],
							},
						},
						total: {
							type: "calc",
							config: {
								formula: [
									"sum",
									[
										"ref",
										"$parent",
										"shown",
										"$each",
										"fields",
										"total",
										"value",
									],
								],
							},
						},
					},
				},
				inputs: {
					rows: {
						template: {
							config: {
								fields: {
									// the columns, in order
									item: { type: "text", meta: { label: "Item" } },
									q1: {
										type: "number",
										meta: { label: "Q1" },
										inputs: { value: 0 },
									},
									q2: {
										type: "number",
										meta: { label: "Q2" },
										inputs: { value: 0 },
									},
									total: {
										type: "calc",
										meta: { label: "Total" },
										config: {
											formula: [
												"add",
												["ref", "q1", "value"],
												["ref", "q2", "value"],
											],
										},
									},
								},
							},
						},
						initial: [
							{
								id: "rent",
								config: {
									showWhen: ["gt", ["ref", "$root", "renting", "value"], 0],
									fields: {
										item: { inputs: { value: "Rent" } },
										q1: { inputs: { value: 1200 } },
									},
								},
							},
							{
								config: {
									fields: {
										item: { inputs: { value: "Salaries" } },
										q1: { inputs: { value: 9000 } },
									},
								},
							},
						],
					},
				},
			},
			size: {
				type: "choice",
				meta: { label: "Size" },
				config: {
					options: {
						enum: [
							{ value: "s", meta: { label: "Small" } },
							{ value: "m", meta: { label: "Medium" } },
						],
					},
				},
			},
			home: {
				use: "address",
				meta: { label: "Home address" },
				params: { showWhen: true },
			},
		},
	},
});

// @ts-expect-error a row only holds fields, groups, tables and sections, never a form
const bad: NodeOf<typeof forms> = {
	type: "section",
	config: { fields: { f: { type: "form" } } },
};

const s = program.run();
const company = s.at(["fields", "company"]);
const vat = s.at(["fields", "company", "fields", "vatId"]);
void [company, vat, bad];
// the Operator's side of the table: rows by the id the program gave them
const rent = s.at(["fields", "budget", "rows", { id: "rent" }]);
const budget = s.at(["fields", "budget"]);
if (budget?.type === "table") {
	const row = budget.list("rows").add(); // takes its columns from the template
	const q1 = row.map("fields").get("q1");
	if (q1?.type === "number") q1.member("value").set(500);
	budget.list("rows").remove("rent"); // allowed; the table's errorWhen reports it
}
void rent;
// ---------- rendering a t.oneOf(TField, EGroup, …) by its traits ----------
// What a form, section or row holds: every entity that implements TField, plus the containers.
type FormHandle = Handle<typeof EForm, typeof forms>;
type Content = NonNullable<ReturnType<ReturnType<FormHandle["map"]>["get"]>>;

function render(node: Content): string {
	// traits first: they work for any entity, including ones added to the kit later
	if (has(node, TConditional)) {
		const visible = node.as(TConditional).member("visible").get();
		if (visible.ok && !visible.value) return "";
	}
	const label = node.meta.label ?? "";
	const error = has(node, TValidated)
		? node.as(TValidated).member("error").get()
		: undefined;
	const issue = error?.ok && error.value ? ` (${error.value})` : "";

	// every field through one branch; TField has no members, so its input still needs the entity
	if (has(node, TField)) {
		// @ts-expect-error a member name must exist on every field: only calc fields have a formula
		node.member("formula");
		switch (node.type) {
			case "text":
			case "number":
			case "calc":
			case "textCalc":
			case "choice": {
				const v = node.member("value").get();
				return `${label}: ${v.ok ? String(v.value ?? "") : v.error.message}${issue}`;
			}
			default:
				return assertNever(node);
		}
	}

	// what's left is exactly the containers
	switch (node.type) {
		case "section":
			return label + renderAll(node.map("fields").entries());
		case "group":
		case "table":
			return (
				label +
				node
					.list("rows")
					.entries()
					.map(([, row]) => renderAll(row.map("fields").entries()))
					.join("\n")
			);
		case "keyedGroup":
			return (
				label +
				node
					.map("rows")
					.entries()
					.map(([, row]) => renderAll(row.map("fields").entries()))
					.join("\n")
			);
		default:
			return assertNever(node);
	}
}
const renderAll = (entries: [string, Content][]) =>
	entries.map(([, child]) => render(child)).join("\n");

declare function assertNever(x: never): never;
void render;

// saving: the document is the root's own derived member
const saved = s.root.member("data").get();
type Equal<A, B> =
	(<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2
		? true
		: false;
type Expect<T extends true> = T;
type _vat = Expect<
	Equal<
		NonNullable<typeof vat>["type"],
		| "text"
		| "number"
		| "choice"
		| "calc"
		| "textCalc"
		| "group"
		| "keyedGroup"
		| "table"
		| "section"
	>
>;
type _company = Expect<
	Equal<
		NonNullable<typeof company>["type"],
		| "text"
		| "number"
		| "choice"
		| "calc"
		| "textCalc"
		| "group"
		| "keyedGroup"
		| "table"
		| "section"
	>
>;
const v = vat!;
if (v.type === "choice") {
	const r = v.member("value").get();
	if (r.ok) {
		const s2: string | null = r.value;
		void s2;
	}
}
if (v.type === "number") {
	v.member("value").set(3);
}
if (v.type === "calc") {
	// @ts-expect-error calc values aren't writable
	v.member("value").set(3);
}
type _saved = Expect<Equal<typeof saved, Result<Json>>>;
type _rent = Expect<Equal<NonNullable<typeof rent>["type"], "row">>;

// biome-ignore format: one line, so the @ts-expect-error below covers the whole call
// @ts-expect-error an initial row can't name a type: it's laid over the template, which already has one
forms.program({ config: { fields: { t: { type: "table", inputs: { rows: { initial: [{ config: { fields: { q1: { type: "text" } } } }] } } } } } });
