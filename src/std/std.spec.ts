import { describe, expect, it } from "vitest";
import { Decimal } from "../values";
import { std } from ".";

const call = (name: "add" | "sub" | "mul" | "div", a: unknown, b: unknown) =>
	std[name].call?.([a, b]);
const dec = (s: string) => Decimal.parse(s, 2) as Decimal;

describe("std arithmetic", () => {
	it("works on numbers", () => {
		expect(call("add", 1, 2)).toEqual({ ok: true, value: 3 });
		expect(call("sub", 1, 2)).toEqual({ ok: true, value: -1 });
		expect(call("mul", 3, 2)).toEqual({ ok: true, value: 6 });
		expect(call("div", 3, 2)).toEqual({ ok: true, value: 1.5 });
	});

	it("returns null for a null argument", () => {
		expect(call("add", null, 2)).toEqual({ ok: true, value: null });
		expect(call("mul", 2, null)).toEqual({ ok: true, value: null });
	});

	it("reports division by zero and overflow as errors", () => {
		expect(call("div", 1, 0)).toMatchObject({
			ok: false,
			error: { code: "div.zero" },
		});
		expect(call("div", dec("1.00"), 0)).toMatchObject({
			ok: false,
			error: { code: "div.zero" },
		});
		expect(call("mul", 1e300, 1e300)).toMatchObject({
			ok: false,
			error: { code: "number.overflow" },
		});
	});

	it("gives a decimal when either argument is one", () => {
		const value = (r: unknown) => String((r as { value: unknown }).value);
		expect(value(call("add", dec("0.10"), dec("0.20")))).toBe("0.30");
		expect(value(call("mul", 2, dec("1.25")))).toBe("2.50");
		expect(value(call("sub", 1, dec("0.25")))).toBe("0.75");
		expect(value(call("div", dec("1.00"), 4))).toBe("0.25");
	});
});

describe("std sum", () => {
	const fold = (values: unknown[]) => {
		const agg = std.sum.aggregate;
		if (!agg) throw new Error("sum has no aggregate");
		let acc = agg.init();
		for (const v of values) acc = agg.add(acc, v);
		return { agg, acc };
	};

	it("skips null and sums exactly", () => {
		const { agg, acc } = fold([0.1, null, 0.2, -0.1]);
		expect(agg.result(acc)).toBe(0.2);
	});

	it("removes a value exactly", () => {
		const { agg, acc } = fold([1e16, 1, -1e16]);
		expect(agg.result(agg.remove(acc, 1))).toBe(0);
	});

	it("sums decimals as decimals", () => {
		const { agg, acc } = fold([dec("0.10"), dec("0.20"), null]);
		expect(String(agg.result(agg.remove(acc, dec("0.10"))))).toBe("0.20");
	});
});
