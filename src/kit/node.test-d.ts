import { describe, expectTypeOf, it } from "vitest";
import type { Quotes } from "../__fixtures__/quote";
import type { NodeOf, PlacementOf, ProgramTree } from ".";

describe("NodeOf", () => {
	it("accepts a placement of any entity in the kit", () => {
		expectTypeOf({
			type: "charge",
			config: { amount: ["mul", 2, 3] },
		} as const).toExtend<NodeOf<Quotes>>();
		expectTypeOf({ type: "note" } as const).toExtend<NodeOf<Quotes>>();
	});

	it("accepts a component placement", () => {
		expectTypeOf({ use: "header" } as const).toExtend<NodeOf<Quotes>>();
	});

	it("rejects an unknown type and missing required config", () => {
		expectTypeOf({ type: "chrage" } as const).not.toExtend<NodeOf<Quotes>>();
		expectTypeOf({ type: "charge" } as const).not.toExtend<NodeOf<Quotes>>();
	});

	it("rejects config the entity doesn't have", () => {
		const _charge: PlacementOf<Quotes> = {
			type: "charge",
			// @ts-expect-error a misspelled config field
			config: { amount: 1, amuont: 2 },
		};
	});
});

describe("ProgramTree", () => {
	type Lines = NonNullable<ProgramTree<Quotes>["config"]>["lines"];
	type Rows = NonNullable<NonNullable<ProgramTree<Quotes>["inputs"]>["rows"]>;

	it("lets a trait-typed map hold only entities that implement the trait", () => {
		expectTypeOf({
			shipping: { type: "charge", config: { amount: 5 } },
		} as const).toExtend<Lines>();
		expectTypeOf({
			memo: { type: "note" },
		} as const).not.toExtend<Lines>();
	});

	it("takes a list input as a template and initial rows", () => {
		type Rows = NonNullable<NonNullable<ProgramTree<Quotes>["inputs"]>["rows"]>;
		expectTypeOf({
			template: { inputs: { qty: 2 } },
			initial: [{ id: "first", inputs: { name: "Desk" } }],
		} as const).toExtend<Rows>();
	});

	it("rejects an initial row that names a type", () => {
		const _rows: Rows = {
			// @ts-expect-error an initial row can't change the template's type
			initial: [{ type: "item", inputs: { qty: 1 } }],
		};
	});
});
