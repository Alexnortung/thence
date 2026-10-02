import { describe, expectTypeOf, it } from "vitest";
import type {
	ECharge,
	EItem,
	ENote,
	EQuote,
	Quotes,
	TNamed,
	TPriced,
} from "../__fixtures__/quote";
import type { Decimal } from "../values";
import type {
	All,
	CountTrue,
	Def,
	Expand,
	MemberIsWritable,
	MemberValue,
	OneNamedWritable,
	OneOf,
	OneWritable,
} from ".";

type Item = Def<typeof EItem>;
type Quote = Def<typeof EQuote>;

describe("MemberValue", () => {
	it("reads an input's type", () => {
		expectTypeOf<MemberValue<Item, "qty">>().toEqualTypeOf<number>();
		expectTypeOf<MemberValue<Item, "price">>().toEqualTypeOf<Decimal>();
		expectTypeOf<MemberValue<Quote, "customer">>().toEqualTypeOf<
			string | null
		>();
	});

	it("evaluates derived arithmetic", () => {
		// Decimal × number stays a decimal; number × number is a number.
		expectTypeOf<MemberValue<Item, "lineTotal">>().toEqualTypeOf<Decimal>();
		expectTypeOf<MemberValue<Item, "doubled">>().toEqualTypeOf<number>();
	});

	it("follows derived values through other derived values", () => {
		expectTypeOf<MemberValue<Quote, "subtotal">>().toEqualTypeOf<Decimal>();
		expectTypeOf<MemberValue<Quote, "total">>().toEqualTypeOf<Decimal>();
	});

	it("reads an optional config value as possibly undefined", () => {
		expectTypeOf<MemberValue<Def<typeof ECharge>, "note">>().toEqualTypeOf<
			string | undefined
		>();
	});
});

describe("MemberIsWritable", () => {
	it("is true for value inputs", () => {
		expectTypeOf<MemberIsWritable<Item, "qty">>().toEqualTypeOf<true>();
	});

	it("is true through a call with exactly one writable argument", () => {
		// qty × 2: only qty is writable, and mul has an inverse for it.
		expectTypeOf<MemberIsWritable<Item, "doubled">>().toEqualTypeOf<true>();
		// 3 × qty: the static argument can come first
		expectTypeOf<MemberIsWritable<Item, "tripled">>().toEqualTypeOf<true>();
		// subtotal − discount: subtotal is a sum, so only discount is writable.
		expectTypeOf<MemberIsWritable<Quote, "total">>().toEqualTypeOf<true>();
	});

	it("is false with two writable arguments, or none", () => {
		// price × qty: both are inputs, so a write can't pick one.
		expectTypeOf<MemberIsWritable<Item, "lineTotal">>().toEqualTypeOf<false>();
		// a sum has no inverse
		expectTypeOf<MemberIsWritable<Quote, "subtotal">>().toEqualTypeOf<false>();
	});

	it("is false for config", () => {
		expectTypeOf<
			MemberIsWritable<Def<typeof ECharge>, "amount">
		>().toEqualTypeOf<false>();
	});
});

describe("your own functions", () => {
	it("are writable through the one argument whose parameter has an inverse", () => {
		// scale(value: qty, factor: 2): value has an inverse
		expectTypeOf<MemberIsWritable<Item, "scaled">>().toEqualTypeOf<true>();
		expectTypeOf<MemberValue<Item, "scaled">>().toEqualTypeOf<number>();
	});

	it("aren't writable through a parameter without an inverse", () => {
		// scale(value: 2, factor: qty): factor has no inverse
		expectTypeOf<MemberIsWritable<Item, "scaledBy">>().toEqualTypeOf<false>();
	});
});

describe("OneWritable", () => {
	it("needs exactly one writable argument, at a position with an inverse", () => {
		expectTypeOf<CountTrue<[true, false, true]>>().toEqualTypeOf<2>();
		expectTypeOf<
			OneWritable<[false, true], [true, true]>
		>().toEqualTypeOf<true>();
		expectTypeOf<
			OneWritable<[false, true], [true, false]>
		>().toEqualTypeOf<false>();
		expectTypeOf<
			OneWritable<[true, true], [true, true]>
		>().toEqualTypeOf<false>();
		expectTypeOf<
			OneWritable<[false, false], [true, true]>
		>().toEqualTypeOf<false>();
	});

	it("works the same by name", () => {
		expectTypeOf<
			OneNamedWritable<{ a: true; b: false }, { a: true; b: false }>
		>().toEqualTypeOf<true>();
		expectTypeOf<
			OneNamedWritable<{ a: false; b: true }, { a: true; b: false }>
		>().toEqualTypeOf<false>();
		expectTypeOf<
			OneNamedWritable<{ a: true; b: true }, { a: true; b: true }>
		>().toEqualTypeOf<false>();
	});
});

describe("Expand", () => {
	it("gives the entities of the kit that implement a trait", () => {
		expectTypeOf<Expand<typeof TPriced, Quotes>>().toEqualTypeOf<
			typeof EItem | typeof ECharge
		>();
		expectTypeOf<Expand<typeof TNamed, Quotes>>().toEqualTypeOf<
			typeof EItem | typeof ENote
		>();
	});

	it("gives the entities that implement every trait of t.all", () => {
		expectTypeOf<
			Expand<All<[typeof TPriced, typeof TNamed]>, Quotes>
		>().toEqualTypeOf<typeof EItem>();
	});

	it("gives exactly the options of t.oneOf", () => {
		expectTypeOf<
			Expand<OneOf<[typeof ECharge, typeof ENote]>, Quotes>
		>().toEqualTypeOf<typeof ECharge | typeof ENote>();
	});
});
