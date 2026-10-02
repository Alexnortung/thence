import { describe, expectTypeOf, it } from "vitest";
import { e, fn, t } from "..";
import type { Fn } from ".";

const toFahrenheit = fn("toFahrenheit", {
	params: { celsius: t.number },
	returns: t.number,
	body: ({ celsius }) => e.add(e.div(e.mul(celsius, 9), 5), 32),
});

const square = fn("square", {
	params: { x: t.number },
	returns: t.number,
	body: ({ x }) => e.mul(x, x),
});

const fromCode = fn("fromCode", {
	params: { code: t.text },
	returns: t.number,
	impl: ({ code }) => Number(code),
	inverse: { code: ({ result }) => String(result) },
});

const parse = fn("parse", {
	params: { code: t.text },
	returns: t.number,
	impl: ({ code }) => Number(code),
});

describe("fn", () => {
	it("derives a body's inverse when the body is writable through the parameter", () => {
		expectTypeOf(toFahrenheit).toEqualTypeOf<
			Fn<"toFahrenheit", { celsius: typeof t.number }, number, [true]>
		>();
	});

	it("has no inverse when the parameter appears twice in the body", () => {
		expectTypeOf(square["~inv"]).toEqualTypeOf<[false]>();
	});

	it("has an inverse for an impl only when one is written", () => {
		expectTypeOf(fromCode["~inv"]).toEqualTypeOf<[true]>();
		expectTypeOf(parse["~inv"]).toEqualTypeOf<[false]>();
	});

	it("rejects a body whose type doesn't match returns", () => {
		fn("wrong", {
			params: { x: t.number },
			returns: t.text,
			// @ts-expect-error a number body for a text function
			body: ({ x }) => e.mul(x, 2),
		});
	});

	it("rejects a body together with an impl", () => {
		// biome-ignore format: the expected error has to stay on the call's line
		// @ts-expect-error body and impl together
		fn("both", { params: { x: t.number }, returns: t.number, body: ({ x }) => x, impl: ({ x }: { x: number }) => x });
	});
});
