import { describe, expect, it } from "vitest";
import { highWord, lowWord } from "./bits";
import { cos, exp, log, pow, sin, tan } from "./math";

/** How many doubles apart a and b are. */
function ulps(a: number, b: number): number {
	if (Object.is(a, b)) return 0;
	if (!Number.isFinite(a) || !Number.isFinite(b))
		return Number.POSITIVE_INFINITY;
	const bits = (x: number) =>
		(BigInt(highWord(x) >>> 0) << 32n) | BigInt(lowWord(x));
	const d = bits(a) - bits(b);
	return Number(d < 0n ? -d : d);
}

/**
 * `n` points spread evenly over [lo, hi), the same on every run, so a
 * failure names an input that can be tried again.
 */
function spread(lo: number, hi: number, n: number): number[] {
	return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / n);
}

// Cross-engine sameness is the determinism harness's job. These check that the
// shared answer is right: within one ulp of V8, which also uses fdlibm here.
describe("exp", () => {
	it.each([
		[-745, -1],
		[-1, 1],
		[1, 710],
	])("is within one ulp of Math.exp from %d to %d", (lo, hi) => {
		for (const x of spread(lo, hi, 5000)) {
			expect(ulps(exp(x), Math.exp(x)), `exp(${x})`).toBeLessThanOrEqual(1);
		}
	});

	it("handles the edges like Math.exp", () => {
		expect(exp(0)).toBe(1);
		expect(exp(1)).toBe(Math.E);
		expect(exp(Number.NEGATIVE_INFINITY)).toBe(0);
		expect(exp(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
		expect(exp(1000)).toBe(Number.POSITIVE_INFINITY);
		expect(exp(-1000)).toBe(0);
		expect(exp(Number.NaN)).toBeNaN();
	});
});

describe("log", () => {
	// Powers of two far apart, each times mantissas from 1 to 2.
	it.each([-1000, -100, -1, 0, 1, 100, 1000])(
		"is within one ulp of Math.log around 2 ** %d",
		(power) => {
			for (const m of spread(1, 2, 5000)) {
				const x = 2 ** power * m;
				expect(ulps(log(x), Math.log(x)), `log(${x})`).toBeLessThanOrEqual(1);
			}
		},
	);

	it("handles the edges like Math.log", () => {
		expect(log(1)).toBe(0);
		expect(log(0)).toBe(Number.NEGATIVE_INFINITY);
		expect(log(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
		expect(log(Number.MIN_VALUE)).toBe(Math.log(Number.MIN_VALUE));
		expect(log(-1)).toBeNaN();
		expect(log(Number.NaN)).toBeNaN();
	});
});

describe("pow", () => {
	// x ** y is Math.pow. A negative base only has a real power for whole exponents.
	it.each([
		[
			"a positive base",
			spread(-20, 20, 400).map((p) => 2 ** p),
			spread(-100, 100, 125),
		],
		[
			"a negative base",
			spread(-20, 20, 400).map((p) => -(2 ** p)),
			spread(-30, 30, 61),
		],
	])("is within one ulp of Math.pow for %s", (_, bases, exponents) => {
		for (const x of bases) {
			for (const y of exponents) {
				expect(ulps(pow(x, y), x ** y), `${x} ** ${y}`).toBeLessThanOrEqual(1);
			}
		}
	});

	it.each([
		[3, 20, 3486784401],
		[10, 15, 1e15],
		[-2, 53, -(2 ** 53)],
		[2, -1074, Number.MIN_VALUE],
	])("gives exact integer powers: %d ** %d", (x, y, power) => {
		expect(pow(x, y)).toBe(power);
	});

	const edges = [
		0,
		-0,
		1,
		-1,
		0.5,
		-0.5,
		2,
		-2,
		3,
		-3,
		0.25,
		1e-310,
		-1e-310,
		1e308,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		Number.NaN,
	];
	it.each(edges.flatMap((x) => edges.map((y) => [x, y])))(
		"handles %d ** %d like Math.pow",
		(x, y) => {
			expect(Object.is(pow(x, y), x ** y)).toBe(true);
		},
	);
});

describe.each([
	["sin", sin, Math.sin],
	["cos", cos, Math.cos],
	["tan", tan, Math.tan],
] as const)("%s", (name, ours, theirs) => {
	// Small, medium and huge arguments take different reductions.
	it.each([2, 8, 22, 100, 1000])(
		"is within one ulp of Math up to 2 ** %d",
		(power) => {
			for (const x of spread(-(2 ** power), 2 ** power, 6000)) {
				expect(ulps(ours(x), theirs(x)), `${name}(${x})`).toBeLessThanOrEqual(
					1,
				);
			}
		},
	);

	it.each(spread(-8, 9, 17))("reduces %d * pi/2 carefully", (k) => {
		const x = (k * Math.PI) / 2;
		expect(ulps(ours(x), theirs(x))).toBeLessThanOrEqual(1);
	});

	it.each([0, -0, 1e-300, Number.MAX_VALUE, Number.NaN])(
		"handles %d like Math",
		(x) => {
			expect(Object.is(ours(x), theirs(x))).toBe(true);
		},
	);

	it("is NaN at infinity", () => {
		expect(ours(Number.POSITIVE_INFINITY)).toBeNaN();
		expect(ours(Number.NEGATIVE_INFINITY)).toBeNaN();
	});
});

it("reduces a huge argument exactly", () => {
	expect(sin(1e22)).toBe(-0.8522008497671888);
});
