import { describe, expectTypeOf, it } from "vitest";
import { e, entity, kit, t } from "..";
import type {
	EntityHandle,
	Handle,
	ListHandle,
	MapHandle,
	MemberHandle,
} from ".";

const ERow = entity("row", {
	inputs: { qty: t.number.initial(0), unitPrice: t.number.initial(0) },
});
const ELine = entity("line", {
	inputs: { amount: t.number.initial(0) },
	derived: { doubled: e.mul(e.self("amount"), 2) },
});
const EOrder = entity("order", {
	inputs: {
		rows: t.list(ERow),
		rates: t.map(ERow),
		tags: t.json.initial([]),
	},
	derived: {
		lines: e.map(
			e.self("rows"),
			e.fn((row) =>
				e.entity(ELine, { amount: e.mul(row("qty"), row("unitPrice")) }),
			),
		),
		bigRows: e.filter(
			e.self("rows"),
			e.fn((row) => row("big")),
		),
		biggest: e.filter(
			e.self("bigRows"),
			e.fn((row) => row("big")),
		),
		rateLines: e.map(
			e.self("rates"),
			e.fn((row) => e.entity(ELine, { amount: row("qty") })),
		),
		qtys: e.map(
			e.self("rows"),
			e.fn((row) => row("qty")),
		),
		tagged: e.filter(
			e.self("tags"),
			e.fn((tag) => tag()),
		),
		vat: e.entity(ELine, { amount: 1 }),
	},
});
const orders = kit({
	name: "orders",
	version: "1.0.0",
	root: EOrder,
	entities: [EOrder, ERow, ELine],
});
type Orders = typeof orders;
declare const order: Handle<typeof EOrder, Orders>;

describe("derived collections", () => {
	it("are lists of the entities a map builds", () => {
		expectTypeOf(order.list("lines")).toEqualTypeOf<
			ListHandle<typeof ELine, Orders>
		>();
		expectTypeOf(order.map("rateLines")).toEqualTypeOf<
			MapHandle<typeof ELine, Orders>
		>();
	});

	it("hold the source's elements after a filter", () => {
		expectTypeOf(order.list("bigRows")).toEqualTypeOf<
			ListHandle<typeof ERow, Orders>
		>();
		expectTypeOf(order.list("biggest")).toEqualTypeOf<
			ListHandle<typeof ERow, Orders>
		>();
	});

	it("aren't values", () => {
		// @ts-expect-error lines is a list
		order.member("lines");
	});
});

describe("map and filter as values", () => {
	it("give a JSON array over values", () => {
		expectTypeOf(order.member("qtys")).toEqualTypeOf<
			MemberHandle<readonly unknown[], false>
		>();
		// @ts-expect-error qtys is a value, not a list
		order.list("qtys");
		// A filter over a JSON array gives what the array is.
		expectTypeOf(order.member("tagged").get()).toEqualTypeOf(
			order.member("tags").get(),
		);
	});
});

describe("derived entities", () => {
	it("are entities", () => {
		expectTypeOf(order.entity("vat")).toEqualTypeOf<
			EntityHandle<typeof ELine, Orders>
		>();
	});
});
