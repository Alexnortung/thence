import { describe, expectTypeOf, it } from "vitest";
import { has } from "..";
import {
	type ECharge,
	type EItem,
	type ENote,
	type EQuote,
	type Quotes,
	TNamed,
	TPriced,
} from "../__fixtures__/quote";
import type { Decimal, Result } from "../values";
import type {
	At,
	EntityHandle,
	Handle,
	InputMember,
	ListHandle,
	MapHandle,
	Member,
	Session,
} from ".";

declare const quote: Handle<typeof EQuote, Quotes>;
declare const item: Handle<typeof EItem, Quotes>;
declare const line: Handle<typeof EItem | typeof ECharge, Quotes>;
declare const extra: Handle<typeof ECharge | typeof ENote, Quotes>;
declare const session: Session<Quotes>;

describe("member handles", () => {
	it("type get() from the member's value", () => {
		expectTypeOf(item.member("qty").get()).toEqualTypeOf<Result<number>>();
		expectTypeOf(item.member("lineTotal").get()).toEqualTypeOf<
			Result<Decimal>
		>();
		expectTypeOf(quote.member("customer").get()).toEqualTypeOf<
			Result<string | null>
		>();
	});

	it("have set() only when the member is writable", () => {
		expectTypeOf(item.member("qty")).toEqualTypeOf<InputMember<number>>();
		expectTypeOf(quote.member("total")).toEqualTypeOf<InputMember<Decimal>>();
		expectTypeOf(item.member("lineTotal")).not.toHaveProperty("set");
		expectTypeOf(quote.member("subtotal")).not.toHaveProperty("set");
	});

	it("let a decimal be set from a string or number", () => {
		expectTypeOf(item.member("price").set)
			.parameter(0)
			.toEqualTypeOf<Decimal | string | number>();
	});

	it("only exist for value members", () => {
		// @ts-expect-error rows is a list, not a value
		quote.member("rows");
	});
});

describe("collections", () => {
	it("give handles to the entities they may hold", () => {
		expectTypeOf(quote.list("rows")).toEqualTypeOf<
			ListHandle<typeof EItem, Quotes>
		>();
		expectTypeOf(quote.map("lines")).toEqualTypeOf<
			MapHandle<typeof EItem | typeof ECharge, Quotes>
		>();
	});
});

describe("unions of handles", () => {
	it("read through a trait every option implements, without has()", () => {
		expectTypeOf(line.as(TPriced).member("total").get()).toEqualTypeOf<
			Result<Decimal>
		>();
	});

	it("need has() before reading a trait only some options implement", () => {
		// @ts-expect-error a charge isn't named
		extra.as(TNamed);
		if (has(extra, TNamed)) {
			expectTypeOf(extra).toEqualTypeOf<EntityHandle<typeof ENote, Quotes>>();
			expectTypeOf(extra.as(TNamed).member("name").get()).toEqualTypeOf<
				Result<string>
			>();
		}
	});

	it("narrow with a switch on type", () => {
		if (extra.type === "note") {
			expectTypeOf(extra.member("text").get()).toEqualTypeOf<Result<string>>();
		}
	});

	it("offer only the members every option has", () => {
		// @ts-expect-error only items have qty
		line.member("qty");
	});
});

describe("At", () => {
	it("walks a path through the kit", () => {
		expectTypeOf<At<Quotes, ["rows"]>>().toEqualTypeOf<
			ListHandle<typeof EItem, Quotes>
		>();
		expectTypeOf<At<Quotes, ["total"]>>().toEqualTypeOf<Member<Decimal>>();
		expectTypeOf<At<Quotes, ["lines", "shipping"]>>().toEqualTypeOf<
			Handle<typeof EItem | typeof ECharge, Quotes>
		>();
	});

	it("takes a row by position or by id", () => {
		expectTypeOf<At<Quotes, ["rows", 0, "qty"]>>().toEqualTypeOf<
			Member<number>
		>();
		expectTypeOf<At<Quotes, ["rows", { id: "first" }, "qty"]>>().toEqualTypeOf<
			Member<number>
		>();
	});

	it("is what session.at returns, or undefined", () => {
		expectTypeOf(session.at(["rows"])).toEqualTypeOf<
			ListHandle<typeof EItem, Quotes> | undefined
		>();
	});
});
