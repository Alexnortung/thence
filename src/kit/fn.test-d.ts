import { describe, expectTypeOf, it } from "vitest";
import { e, fn, t } from "..";
import type { Fn } from ".";

const toFahrenheit = fn("toFahrenheit", {
	params: [{ celsius: t.number }],
	returns: t.number,
	body: ({ celsius }) => e.add(e.div(e.mul(celsius, 9), 5), 32),
});

const square = fn("square", {
	params: [{ x: t.number }],
	returns: t.number,
	body: ({ x }) => e.mul(x, x),
});

const fromCode = fn("fromCode", {
	params: [{ code: t.text }],
	returns: t.number,
	impl: ({ code }) => Number(code),
	inverse: { code: ({ result }) => String(result) },
});

const offset = fn("offset", {
	params: [{ value: t.number }, { by: t.number }],
	returns: t.number,
	body: ({ value, by }) => e.add(value, by),
});

const ratio = fn("ratio", {
	params: [{ a: t.number }, { b: t.number }],
	returns: t.number,
	impl: ({ a, b }) => a / b,
	inverse: { a: ({ result, b }) => result * b },
});

const parse = fn("parse", {
	params: [{ code: t.text }],
	returns: t.number,
	impl: ({ code }) => Number(code),
});

describe("fn", () => {
	it("derives a body's inverse when the body is writable through the parameter", () => {
		expectTypeOf(toFahrenheit).toEqualTypeOf<
			Fn<
				"toFahrenheit",
				{ celsius: typeof t.number },
				number,
				{ celsius: true }
			>
		>();
	});

	it("has no inverse when the parameter appears twice in the body", () => {
		expectTypeOf(square["~inv"]).toEqualTypeOf<{ x: false }>();
	});

	it("has an inverse for an impl only when one is written", () => {
		expectTypeOf(fromCode["~inv"]).toEqualTypeOf<{ code: true }>();
		expectTypeOf(parse["~inv"]).toEqualTypeOf<{ code: false }>();
	});

	it("keeps an inverse per parameter by name", () => {
		expectTypeOf(offset["~inv"]).toEqualTypeOf<{ value: true; by: true }>();
		expectTypeOf(ratio["~inv"]).toEqualTypeOf<{ a: true; b: false }>();
	});

	it("takes named arguments in e.call", () => {
		e.call(ratio, { a: 1, b: 2 });
		// @ts-expect-error b is missing
		e.call(ratio, { a: 1 });
	});

	it("rejects a body whose type doesn't match returns", () => {
		fn("wrong", {
			params: [{ x: t.number }],
			returns: t.text,
			// @ts-expect-error a number body for a text function
			body: ({ x }) => e.mul(x, 2),
		});
	});

	it("rejects a body together with an impl", () => {
		// biome-ignore format: the expected error has to stay on the call's line
		// @ts-expect-error body and impl together
		fn("both", { params: [{ x: t.number }], returns: t.number, body: ({ x }) => x, impl: ({ x }: { x: number }) => x });
	});

	it("takes params as a list and indexes them by name", () => {
		expectTypeOf(ratio["~params"]).toEqualTypeOf<{
			a: typeof t.number;
			b: typeof t.number;
		}>();
	});

	it("rejects a params entry that doesn't name exactly one parameter", () => {
		// biome-ignore format: the expected error has to stay on the call's line
		// @ts-expect-error two parameters in one entry
		fn("two", { params: [{ a: t.number, b: t.number }], returns: t.number, impl: () => 0 });
		// biome-ignore format: the expected error has to stay on the call's line
		// @ts-expect-error an entry with no parameter
		fn("none", { params: [{}], returns: t.number, impl: () => 0 });
	});
});
