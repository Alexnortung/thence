import { describe, expect, it } from "vitest";
import { highWord, lowWord } from "./bits";
import { exp, log } from "./math";

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

function random(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
	};
}

// Cross-engine sameness is the determinism harness's job. These check that the
// shared answer is right: within one ulp of V8, which also uses fdlibm here.
describe("exp", () => {
	it("is within one ulp of Math.exp", () => {
		const r = random(7);
		for (let i = 0; i < 20_000; i++) {
			const x = (r() - 0.5) * 1400;
			expect(ulps(exp(x), Math.exp(x))).toBeLessThanOrEqual(1);
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
	it("is within one ulp of Math.log", () => {
		const r = random(8);
		for (let i = 0; i < 20_000; i++) {
			const x = 2 ** (r() * 2000 - 1000) * (1 + r());
			expect(ulps(log(x), Math.log(x))).toBeLessThanOrEqual(1);
		}
	});

	it("handles the edges like Math.log", () => {
		expect(log(1)).toBe(0);
		expect(log(0)).toBe(Number.NEGATIVE_INFINITY);
		expect(log(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
		expect(log(Number.MIN_VALUE)).toBe(Math.log(Number.MIN_VALUE));
		expect(log(-1)).toBeNaN();
		expect(log(Number.NaN)).toBeNaN();
	});
});
