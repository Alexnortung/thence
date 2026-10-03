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

describe("pow", () => {
	it("is within one ulp of Math.pow", () => {
		// x ** y is Math.pow
		const r = random(9);
		for (let i = 0; i < 50_000; i++) {
			const x = 2 ** (r() * 40 - 20) * (r() < 0.1 ? -1 : 1);
			const y = x < 0 ? Math.round((r() - 0.5) * 60) : (r() - 0.5) * 200;
			expect(ulps(pow(x, y), x ** y)).toBeLessThanOrEqual(1);
		}
	});

	it("gives exact integer powers", () => {
		expect(pow(3, 20)).toBe(3486784401);
		expect(pow(10, 15)).toBe(1e15);
		expect(pow(-2, 53)).toBe(-(2 ** 53));
		expect(pow(2, -1074)).toBe(Number.MIN_VALUE);
	});

	it("handles the edges like Math.pow", () => {
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
		for (const x of edges) {
			for (const y of edges) {
				expect(Object.is(pow(x, y), x ** y), `${x} ** ${y}`).toBe(true);
			}
		}
	});
});

describe("sin, cos and tan", () => {
	const fns = [
		["sin", sin, Math.sin],
		["cos", cos, Math.cos],
		["tan", tan, Math.tan],
	] as const;

	it("are within one ulp of Math, near zero and far from it", () => {
		const r = random(10);
		for (let i = 0; i < 30_000; i++) {
			// small, medium and huge arguments, which take different reductions
			const x = (r() - 0.5) * 2 ** ([2, 8, 22, 100, 1000][i % 5] as number);
			for (const [name, ours, theirs] of fns) {
				expect(ulps(ours(x), theirs(x)), `${name}(${x})`).toBeLessThanOrEqual(
					1,
				);
			}
		}
	});

	it("reduce multiples of pi/2 carefully", () => {
		for (let k = -8; k <= 8; k++) {
			const x = (k * Math.PI) / 2;
			for (const [name, ours, theirs] of fns) {
				expect(ulps(ours(x), theirs(x)), `${name}(${x})`).toBeLessThanOrEqual(
					1,
				);
			}
		}
		expect(sin(1e22)).toBe(-0.8522008497671888);
	});

	it("handle the edges like Math", () => {
		for (const x of [0, -0, 1e-300, Number.MAX_VALUE, Number.NaN]) {
			for (const [name, ours, theirs] of fns) {
				expect(Object.is(ours(x), theirs(x)), `${name}(${x})`).toBe(true);
			}
		}
		expect(sin(Number.POSITIVE_INFINITY)).toBeNaN();
		expect(cos(Number.NEGATIVE_INFINITY)).toBeNaN();
	});
});
