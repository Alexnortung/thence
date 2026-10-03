// Tables: an Operator's rows from the Builder's template, starting rows laid
// over it, cells by row id, and hidden rows left out of the totals. The
// acceptance test is the budget program from the user stories.

import { describe, expect, it } from "vitest";
import { e, entity, kit, std, t } from "..";

const value = (r: unknown) => (r as { value: unknown }).value;
const must = <T>(x: T | undefined): T => {
	if (x === undefined) throw new Error("expected a handle");
	return x;
};

/** A field is a text, a number or a calc; these are numbers. */
const setNumber = (field: { member(name: "value"): unknown }, v: number) =>
	(field.member("value") as { set(v: number): unknown }).set(v);

const EText = entity("text", { inputs: { value: t.text.initial("") } });
const ENumber = entity("number", { inputs: { value: t.number.initial(0) } });
const ECalc = entity("calc", {
	config: { formula: t.expr(t.number.nullable()) },
	derived: { value: e.self("formula") },
});
const ERow = entity("row", {
	config: {
		fields: t.map(t.oneOf(EText, ENumber, ECalc)),
		showWhen: t.expr(t.bool),
	},
	derived: { visible: e.self("showWhen") },
});
const ETable = entity("table", {
	config: { totals: t.map(ECalc) },
	inputs: { rows: t.list(ERow) },
	derived: {
		shown: e.filter(
			e.self("rows"),
			e.fn((row) => row("visible")),
		),
	},
});
const EBudget = entity("budget", {
	config: { budget: ETable },
	inputs: { renting: t.bool.initial(true) },
});
const budgets = kit({
	name: "budgets",
	version: "1.0.0",
	functions: { ...std },
	root: EBudget,
	entities: [EBudget, ETable, ERow, EText, ENumber, ECalc],
});

const total = (column: string) => ({
	type: "calc",
	config: {
		formula: [
			"sum",
			["ref", "$parent", "shown", "$each", "fields", column, "value"],
		],
	},
});
const program = (rows: unknown) =>
	budgets.program({
		config: {
			budget: {
				type: "table",
				config: {
					totals: {
						q1: total("q1"),
						q2: total("q2"),
						total: total("total"),
						rent: {
							type: "calc",
							config: {
								formula: [
									"ref",
									"$parent",
									"rows",
									{ id: "rent" },
									"fields",
									"q1",
									"value",
								],
							},
						},
					},
				},
				inputs: { rows },
			},
		},
	} as never);

const budget = {
	template: {
		config: {
			showWhen: true,
			fields: {
				item: { type: "text" },
				q1: { type: "number", inputs: { value: 0 } },
				q2: { type: "number", inputs: { value: 0 } },
				total: {
					type: "calc",
					config: {
						formula: ["add", ["ref", "q1", "value"], ["ref", "q2", "value"]],
					},
				},
			},
		},
	},
	initial: [
		{
			id: "rent",
			config: {
				showWhen: ["ref", "$root", "renting"],
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
};

const start = () => {
	const p = program(budget);
	const session = p.run([], { replica: "c1" });
	const table = session.root.entity("budget");
	const totals = (key: string) =>
		value(table.map("totals").get(key)?.member("value").get());
	return { program: p, session, table, totals };
};

describe("the budget table", () => {
	it("starts with the Builder's rows, laid over the template", () => {
		const { program: p, table, totals } = start();
		expect(p.diagnostics).toEqual([]);
		const rows = table.list("rows");
		expect(rows.entries().map(([id]) => id)).toEqual(["rent", "1"]);
		const rent = must(rows.at(0));
		const item = rent.map("fields").get("item");
		expect(value(item?.member("value").get())).toBe("Rent");
		expect(totals("q1")).toBe(10200);
		expect(totals("total")).toBe(10200);
		expect(totals("rent")).toBe(1200);
	});

	it("gives rows the Operator adds the template's columns", () => {
		const { table, totals } = start();
		const added = table.list("rows").add();
		const fields = added.map("fields");
		expect(fields.entries().map(([id]) => id)).toEqual([
			"item",
			"q1",
			"q2",
			"total",
		]);
		setNumber(must(fields.get("q2")), 50);
		expect(value(must(fields.get("total")).member("value").get())).toBe(50);
		expect(totals("q2")).toBe(50);
		expect(totals("total")).toBe(10250);
	});

	it("leaves hidden rows out of the totals", () => {
		const { session, totals } = start();
		session.root.member("renting").set(false);
		expect(totals("q1")).toBe(9000);
		expect(totals("rent")).toBe(1200);
	});

	it("lets the Operator edit and remove a starting row, which then reads null", () => {
		const { table, totals } = start();
		const rows = table.list("rows");
		const rent = must(rows.at(0)).map("fields");
		setNumber(must(rent.get("q1")), 1500);
		expect(totals("rent")).toBe(1500);
		rows.remove("rent");
		expect(totals("rent")).toBeNull();
		expect(totals("q1")).toBe(9000);
	});

	it("replays to the same values", () => {
		const one = start();
		const q2 = must(one.table.list("rows").at(1)).map("fields").get("q2");
		setNumber(must(q2), 7);
		one.table.list("rows").remove("rent");
		const two = program(budget).run(one.session.ops(), { replica: "c2" });
		expect(two.snapshot()).toEqual(one.session.snapshot());
	});
});

describe("starting rows", () => {
	it("take a plain array as the starting rows, each a node of its own", () => {
		const p = program([
			{
				id: "a",
				config: {
					showWhen: true,
					fields: {
						q1: { type: "number", inputs: { value: 3 } },
						q2: { type: "number" },
						total: { type: "number" },
					},
				},
			},
		]);
		// Rows the Operator adds have no template here, so only the starting row is complete.
		const inRow = p.diagnostics.filter(
			(d) => d.at[1] === "rows" && d.at.length > 2,
		);
		expect(inRow).toEqual([]);
		const rows = p
			.run([], { replica: "c1" })
			.root.entity("budget")
			.list("rows");
		expect(rows.entries().map(([id]) => id)).toEqual(["a"]);
		expect(
			p
				.run([])
				.root.entity("budget")
				.map("totals")
				.get("q1")
				?.member("value")
				.get(),
		).toEqual({ ok: true, value: 3 });
	});

	it("can't add a field the template lacks, change its type, or repeat an id", () => {
		const p = program({
			template: budget.template,
			initial: [
				{ id: "a", config: { fields: { extra: { inputs: { value: 1 } } } } },
				{ id: "a" },
				{ config: { fields: { q1: { type: "text" } } } },
			],
		});
		expect(p.diagnostics.map((d) => d.code)).toEqual([
			"overlay.field",
			"key.invalid",
			"overlay.type",
		]);
	});
});

describe("a map's starting entries", () => {
	const ERates = entity("rates", { inputs: { rates: t.map(ENumber) } });
	const rates = kit({
		name: "rates",
		version: "1.0.0",
		functions: { ...std },
		root: ERates,
		entities: [ERates, ENumber],
	});

	it("start under their keys, over the template", () => {
		const p = rates.program({
			inputs: {
				rates: {
					template: { inputs: { value: 25 } },
					initial: { SE: {}, NO: { inputs: { value: 15 } } },
				},
			},
		});
		expect(p.diagnostics).toEqual([]);
		const map = p.run([], { replica: "c1" }).root.map("rates");
		expect(map.entries().map(([key]) => key)).toEqual(["SE", "NO"]);
		expect(value(must(map.get("NO")).member("value").get())).toBe(15);
		expect(value(must(map.get("SE")).member("value").get())).toBe(25);
		expect(value(map.add("DK").member("value").get())).toBe(25);
	});
});
