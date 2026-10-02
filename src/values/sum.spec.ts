import { describe, expect, it } from "vitest";
import { highWord, lowWord } from "./bits";
import { ExactSum, fsum } from "./sum";

/** A double as m * 2^e with integer m. */
function split(x: number): [bigint, number] {
	const hi = highWord(x);
	const e = (hi >>> 20) & 0x7ff;
	let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lowWord(x));
	if (e !== 0) m |= 1n << 52n;
	return [hi < 0 ? -m : m, (e === 0 ? 1 : e) - 1075];
}

/** The exact sum with bigint, rounded by `Number(bigint)`, which rounds half-even. */
function reference(xs: number[]): number {
	const parts = xs.map(split);
	const min = Math.min(...parts.map(([, e]) => e));
	let n = 0n;
	for (const [m, e] of parts) n += m << BigInt(e - min);
	const r = Number(n) * 2 ** min;
	return r === 0 ? 0 : r;
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

describe("ExactSum", () => {
	const r = random(42);
	const pick = () => (r() - 0.5) * 2 ** Math.floor(r() * 120 - 60);
	const cases = Array.from({ length: 2_000 }, (_, k) => {
		const xs = Array.from({ length: 2 + Math.floor(r() * 60) }, pick);
		// Cancelling pairs and near-ties, which naive summation gets wrong.
		if (k % 3 === 0) xs.push(1e16, 1, -1e16);
		if (k % 5 === 0) xs.push(2 ** 53, 1, 2 ** -60);
		return xs;
	});

	it("matches the exact sum, rounded once", () => {
		for (const xs of cases) expect(fsum(xs)).toBe(reference(xs));
	});

	it("doesn't depend on order", () => {
		for (const xs of cases)
			expect(fsum([...xs].sort(() => r() - 0.5))).toBe(fsum(xs));
	});

	it("gives exactly the sum of what is left after removals", () => {
		for (const xs of cases) {
			const sum = new ExactSum();
			for (const x of xs) sum.add(x);
			for (const [i, x] of xs.entries()) if (i % 2 === 1) sum.remove(x);
			expect(sum.value()).toBe(reference(xs.filter((_, i) => i % 2 === 0)));
		}
	});

	it("is 0 when empty or cancelled, never -0", () => {
		expect(Object.is(new ExactSum().value(), 0)).toBe(true);
		expect(Object.is(fsum([-0]), 0)).toBe(true);
		expect(Object.is(fsum([0.1, -0.1]), 0)).toBe(true);
	});

	it("overflows to an infinity", () => {
		expect(fsum([Number.MAX_VALUE, Number.MAX_VALUE])).toBe(
			Number.POSITIVE_INFINITY,
		);
	});
});
