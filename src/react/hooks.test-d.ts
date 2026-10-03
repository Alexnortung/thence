import { describe, expectTypeOf, it } from "vitest";
import type { EItem, EQuote, Quotes } from "../__fixtures__/quote";
import type { Handle } from "../session";
import type { Decimal, Result } from "../values";
import { useEntries, useValue } from ".";

declare const quote: Handle<typeof EQuote, Quotes>;
declare const item: Handle<typeof EItem, Quotes>;

describe("thence/react", () => {
	it("types a value from the member", () => {
		expectTypeOf(useValue(item.member("qty"))).toEqualTypeOf<Result<number>>();
		expectTypeOf(useValue(quote.member("total"))).toEqualTypeOf<
			Result<Decimal>
		>();
	});

	it("types entries from the collection", () => {
		expectTypeOf(useEntries(quote.list("rows"))).toEqualTypeOf<
			[string, Handle<typeof EItem, Quotes>][]
		>();
	});
});
