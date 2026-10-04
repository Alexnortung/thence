import { describe, expectTypeOf, it } from "vitest";
import type { EItem, EQuote, Quotes } from "../__fixtures__/quote";
import type { Op } from "../log";
import type { Handle, Session } from "../session";
import type { Decimal, Result } from "../values";
import {
	type EntriesAt,
	useEntries,
	useValue,
	useWritable,
	type ValueAt,
} from ".";

declare const session: Session<Quotes>;
declare const quote: Handle<typeof EQuote, Quotes>;
declare const item: Handle<typeof EItem, Quotes>;

describe("thence/react", () => {
	it("types a value from where its path starts", () => {
		expectTypeOf(useValue(item, ["qty"])).toEqualTypeOf<Result<number>>();
		expectTypeOf(useValue(session, ["total"])).toEqualTypeOf<Result<Decimal>>();
	});

	it("may find no row at a position or an id", () => {
		expectTypeOf(useValue(quote, ["rows", 0, "qty"])).toEqualTypeOf<
			Result<number> | undefined
		>();
		expectTypeOf(useValue(quote, ["rows", { id: "a" }, "qty"])).toEqualTypeOf<
			Result<number> | undefined
		>();
	});

	it("rejects a path that doesn't name a value", () => {
		// @ts-expect-error no such member
		useValue(item, ["nope"]);
		// @ts-expect-error a list, not a value
		useValue(quote, ["rows"]);
	});

	it("sets a value through useWritable", () => {
		expectTypeOf(useWritable(item, ["qty"])).toEqualTypeOf<
			[value: Result<number>, set: (v: number) => Result<Op>]
		>();
		expectTypeOf(useWritable(item, ["price"])[1])
			.parameter(0)
			.toEqualTypeOf<Decimal | string | number>();
	});

	it("types entries from the collection", () => {
		expectTypeOf(useEntries(quote, ["rows"])).toEqualTypeOf<
			[string, Handle<typeof EItem, Quotes>][]
		>();
		// @ts-expect-error a value, not a collection
		useEntries(item, ["qty"]);
	});

	it("types a path alone from the registered kit, or as unknown", () => {
		// What `Register` gives once an app names its kit.
		expectTypeOf<ValueAt<Session<Quotes>, ["total"]>>().toEqualTypeOf<
			Result<Decimal>
		>();
		expectTypeOf<EntriesAt<Session<Quotes>, ["rows"]>>().toEqualTypeOf<
			[string, Handle<typeof EItem, Quotes>][]
		>();
		expectTypeOf(useValue(["anything"])).toEqualTypeOf<
			Result<unknown> | undefined
		>();
	});
});
