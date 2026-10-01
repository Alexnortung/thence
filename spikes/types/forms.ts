// The README's form builder, as written, against the spike's types.

import type { NodeOf } from "thence";
import { e, entity, impl, kit, std, t, trait } from "thence";

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

const ERow = entity("row", { config: { fields: content }, impls: [merged] });
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
	impls: [
		visible,
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
const EForm = entity("form", { config: { fields: content }, impls: [merged] });

export const forms = kit({
	name: "forms",
	version: "1.0.0",
	functions: { ...std },
	root: EForm,
	data: TData,
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
	meta: t.meta<{ label?: string }>(),
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
