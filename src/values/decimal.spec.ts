import { describe, expect, it } from "vitest";
import { Decimal } from "./decimal";

const d = (text: string, scale: number) => {
	const value = Decimal.parse(text, scale);
	if (!value) throw new Error(`not a decimal: ${text}`);
	return value;
};

describe("Decimal", () => {
	it("prints every digit of its scale and never -0", () => {
		expect(d("12", 0).toString()).toBe("12");
		expect(d("19.9", 2).toString()).toBe("19.90");
		expect(d("-0.5", 2).toString()).toBe("-0.50");
		expect(d("-0.004", 3).rescale(2).toString()).toBe("0.00");
		expect(JSON.stringify({ price: d("19.99", 2) })).toBe('{"price":"19.99"}');
	});

	it("rounds half-even", () => {
		expect(d("2.5", 1).rescale(0).toString()).toBe("2");
		expect(d("3.5", 1).rescale(0).toString()).toBe("4");
		expect(d("-2.5", 1).rescale(0).toString()).toBe("-2");
		expect(d("-3.5", 1).rescale(0).toString()).toBe("-4");
		expect(d("2.51", 2).rescale(0).toString()).toBe("3");
		expect(d("0.125", 2).toString()).toBe("0.12");
	});

	it("rejects text that isn't a decimal", () => {
		for (const text of ["", "1.", ".5", "1e3", "+1", "1,5", " 1"])
			expect(Decimal.parse(text, 2)).toBeUndefined();
	});

	it("reads numbers from their shortest decimal form", () => {
		expect(Decimal.from(0.05, 4).toString()).toBe("0.0500");
		expect(Decimal.from(19.99, 2).toString()).toBe("19.99");
		expect(Decimal.from(1e-7, 8).toString()).toBe("0.00000010");
		expect(Decimal.from(1e21, 0).toString()).toBe("1000000000000000000000");
		expect(() => Decimal.from(Number.NaN, 2)).toThrow(RangeError);
		expect(() => Decimal.from(Number.POSITIVE_INFINITY, 2)).toThrow(RangeError);
	});

	it("keeps the receiver's scale unless told otherwise", () => {
		expect(d("0.1", 2).add(d("0.2", 2)).toString()).toBe("0.30");
		expect(d("10.00", 2).add(d("0.0051", 4)).toString()).toBe("10.01");
		expect(d("10.00", 2).add(d("0.0051", 4), 4).toString()).toBe("10.0051");
		expect(d("19.99", 2).mul(3).toString()).toBe("59.97");
		expect(d("200.00", 2).mul(d("5.0000", 4)).div(100)?.toString()).toBe(
			"10.00",
		);
		expect(d("1.00", 2).sub(0.05).toString()).toBe("0.95");
	});

	it("divides, rounding once", () => {
		expect(d("1", 0).div(3, 4)?.toString()).toBe("0.3333");
		expect(d("2", 0).div(3, 4)?.toString()).toBe("0.6667");
		// The README's discount inverse: 50.00 × 100 / 200.00
		expect(d("50.00", 2).mul(100, 4).div(d("200.00", 2), 4)?.toString()).toBe(
			"25.0000",
		);
		expect(d("1.00", 2).div(0)).toBeUndefined();
		expect(d("1.00", 2).div(d("0.000", 3))).toBeUndefined();
	});

	it("compares values, not digits", () => {
		expect(d("1.50", 2).equals(d("1.5", 1))).toBe(true);
		expect(d("1.5", 1).compare(d("1.49", 2))).toBe(1);
		expect(d("-1", 0).compare(d("0.00", 2))).toBe(-1);
	});

	it("rejects scales that aren't whole numbers from 0", () => {
		expect(() => Decimal.parse("1", -1)).toThrow(RangeError);
		expect(() => d("1", 0).rescale(1.5)).toThrow(RangeError);
		expect(() => d("1", 0).div(3, -2)).toThrow(RangeError);
	});

	it("converts to a number for display", () => {
		expect(d("19.99", 2).toNumber()).toBe(19.99);
		expect(d("-0.00", 2).toNumber()).toBe(0);
	});
});
