// Validation: checks on types report issues, and never change a value.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { e, entity, impl, kit, t, trait } from "..";
import type { StandardSchemaV1 } from "../kit";

const value = (r: unknown) => (r as { value: unknown }).value;

const TPriced = trait("priced", {
	total: t.number.check(z.number().nonnegative("can't be negative")),
});
const ERow = entity("row", {
	inputs: {
		qty: t.int.initial(1).check(z.number().min(1).max(100)),
		price: t.number.initial(0),
	},
	impls: [impl(TPriced, { total: e.mul(e.self("qty"), e.self("price")) })],
});
const EOrder = entity("order", {
	config: {
		code: t.text.check(z.string().min(2, "too short")),
		limit: t.expr(t.number.check(z.number().max(10, "over the limit"))),
	},
	inputs: { rows: t.list(ERow), budget: t.number.initial(5) },
	derived: { total: e.sum(e.each("rows", TPriced, "total")) },
});
const orders = kit({
	name: "orders",
	version: "1",
	root: EOrder,
	entities: [EOrder, ERow],
	meta: z.object({ label: z.string() }).strict(),
});
const tree = {
	config: { code: "ab", limit: ["ref", "budget"] },
} as const;

describe("issues", () => {
	it("reports what a check finds, and keeps the value", () => {
		const session = orders.program(tree).run();
		const qty = session.root.list("rows").add().member("qty");
		expect(qty.issues()).toEqual([]);
		qty.set(1000);
		expect(value(qty.get())).toBe(1000);
		const [issue] = qty.issues();
		expect(issue?.message).toMatch(/100/);
		expect(session.at(issue?.path ?? [])).toBe(qty);
		expect(qty.issues()).toBe(qty.issues());
		qty.set(5);
		expect(qty.issues()).toEqual([]);
	});

	it("collects the issues of an entity and all it holds", () => {
		const session = orders.program(tree).run();
		const rows = session.root.list("rows");
		const a = rows.add();
		const b = rows.add();
		a.member("qty").set(0);
		b.member("price").set(-2);
		expect(a.issues().map((i) => i.path)).toEqual([[...pathOf(a), "qty"]]);
		expect(b.issues()).toEqual([
			{
				message: "can't be negative",
				path: [...pathOf(b), "as:priced", "total"],
			},
		]);
		expect(session.issues()).toEqual([...a.issues(), ...b.issues()]);
		const before = session.issues();
		expect(session.issues()).toBe(before);
		rows.remove(a.id);
		expect(session.issues()).toEqual(b.issues());
	});

	it("checks a Builder's formula when it computes", () => {
		const session = orders.program(tree).run();
		expect(session.issues()).toEqual([]);
		session.root.member("budget").set(12);
		expect(session.issues()).toEqual([
			{ message: "over the limit", path: ["limit"] },
		]);
	});

	it("leaves an error value to the error", () => {
		const session = orders
			.program({
				...tree,
				config: { ...tree.config, limit: ["div", 1, 0] },
			} as never)
			.run();
		expect(session.root.member("limit").get()).toMatchObject({ ok: false });
		expect(session.issues()).toEqual([]);
	});

	it("reports a check that gives its verdict later", () => {
		const later: StandardSchemaV1 = {
			"~standard": {
				version: 1,
				vendor: "test",
				validate: async (v) => ({ value: v }),
			},
		};
		const ENote = entity("note", {
			inputs: { text: t.text.initial("").check(later) },
		});
		const notes = kit({
			name: "n",
			version: "1",
			root: ENote,
			entities: [ENote],
		});
		const [issue] = notes.program({}).run().issues();
		expect(issue?.message).toMatch(/^check\.async/);
	});

	it("never lets a schema's output replace the value", () => {
		const ENote = entity("note", {
			inputs: {
				text: t.text
					.initial("hi")
					.check(z.string().transform((s) => s.toUpperCase())),
			},
		});
		const notes = kit({
			name: "n",
			version: "1",
			root: ENote,
			entities: [ENote],
		});
		const session = notes.program({}).run();
		expect(session.issues()).toEqual([]);
		expect(value(session.root.member("text").get())).toBe("hi");
	});
});

describe("building a program", () => {
	it("reports a config value that fails its check", () => {
		const program = orders.program({
			...tree,
			config: { ...tree.config, code: "a" },
		});
		expect(program.diagnostics).toMatchObject([
			{ code: "check.failed", message: "too short", at: [], field: "code" },
		]);
		expect(program.run().issues()).toEqual([
			{ message: "too short", path: ["code"] },
		]);
	});

	it("checks every node's meta against the kit's schema", () => {
		const EItem = entity("item", { inputs: { n: t.number.initial(0) } });
		const EList = entity("list", { config: { items: t.map(EItem) } });
		const lists = kit({
			name: "lists",
			version: "1",
			root: EList,
			entities: [EList, EItem],
			meta: z.object({ label: z.string() }).strict(),
		});
		const program = lists.program({
			config: {
				items: {
					good: { type: "item", meta: { label: "Good" } },
					bad: { type: "item", meta: { lable: "Bad" } } as never,
				},
			},
		});
		expect(program.diagnostics.map((d) => [d.code, d.at])).toEqual([
			["meta.invalid", ["items", "bad"]],
			["meta.invalid", ["items", "bad"]],
		]);
		const items = program.run().root.map("items");
		expect(items.get("good")?.meta).toEqual({ label: "Good" });
	});
});

/** Where a row is, as `session.at` takes it. */
function pathOf(row: { id: string }) {
	return ["rows", { id: row.id }];
}
