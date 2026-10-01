// Correctness checks against exact references, run in Node.
// The cross-engine digests prove sameness; these prove the shared answer is right.

import { highWord, lowWord } from "./bits.js";
import { Decimal } from "./decimal.js";
import { ExactSum, fsum } from "./fsum.js";
import { exp, log } from "./math.js";

let failures = 0;
const fail = (msg: string) => {
	failures++;
	if (failures <= 20) console.error("FAIL", msg);
};

// ---------- fsum is the correctly rounded exact sum ----------

/** A double as m * 2^e with integer m. */
function split(x: number): [bigint, number] {
	const hi = highWord(x),
		lo = lowWord(x);
	const e = (hi >>> 20) & 0x7ff;
	let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
	if (e !== 0) m |= 1n << 52n;
	const exp2 = (e === 0 ? 1 : e) - 1075;
	return [hi < 0 ? -m : m, exp2];
}

/** Exact sum with BigInt, rounded to a double by Number(bigint), which rounds half-even. */
function exactSum(xs: number[]): number {
	const parts = xs.map(split);
	const emin = Math.min(...parts.map(([, e]) => e));
	let n = 0n;
	for (const [m, e] of parts) n += m << BigInt(e - emin);
	const r = Number(n) * 2 ** emin; // exact scaling: inputs keep the result normal
	return r === 0 ? 0 : r;
}

function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
	};
}
{
	const r = rng(42);
	const pick = () => (r() - 0.5) * 2 ** Math.floor(r() * 120 - 60);
	let checked = 0;
	for (let k = 0; k < 5_000; k++) {
		const xs = Array.from({ length: 2 + Math.floor(r() * 60) }, pick);
		// add cancelling pairs and near-ties, which naive summation gets wrong
		if (k % 3 === 0) xs.push(1e16, 1, -1e16);
		if (k % 5 === 0) xs.push(2 ** 53, 1, 2 ** -60);
		const want = exactSum(xs);
		const got = fsum(xs);
		if (!Object.is(got, want))
			fail(`fsum ${xs.length} values: got ${got}, want ${want}`);
		// any order gives the same bits
		const shuffled = [...xs].sort(() => r() - 0.5);
		if (!Object.is(fsum(shuffled), want)) fail("fsum depends on order");
		// incremental: add everything, remove half, compare with the sum of what's left
		const acc = new ExactSum();
		for (const x of xs) acc.add(x);
		const kept = xs.filter((_, i) => i % 2 === 0);
		xs.forEach((x, i) => {
			if (i % 2 === 1) acc.remove(x);
		});
		if (!Object.is(acc.value(), exactSum(kept)))
			fail("incremental remove isn't exact");
		checked++;
	}
	console.log(
		`fsum: ${checked} sums matched the exact BigInt reference, in any order and after removals`,
	);
}

// ---------- exp and log are within one ulp of Math, and usually equal ----------

function ulpDiff(a: number, b: number): number {
	if (Object.is(a, b)) return 0;
	if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
	const ia = (BigInt(highWord(a) >>> 0) << 32n) | BigInt(lowWord(a));
	const ib = (BigInt(highWord(b) >>> 0) << 32n) | BigInt(lowWord(b));
	const d = ia > ib ? ia - ib : ib - ia;
	return Number(d);
}
{
	const r = rng(7);
	for (const [name, f, g, gen] of [
		["exp", exp, Math.exp, () => (r() - 0.5) * 1400],
		["log", log, Math.log, () => 2 ** (r() * 2000 - 1000) * (1 + r())],
	] as const) {
		let worst = 0,
			same = 0;
		const n = 200_000;
		for (let i = 0; i < n; i++) {
			const x = gen();
			const u = ulpDiff(f(x), g(x));
			if (u === 0) same++;
			worst = Math.max(worst, u);
		}
		if (worst > 1) fail(`${name}: ${worst} ulp from Math.${name}`);
		console.log(
			`${name}: ${((same / n) * 100).toFixed(2)}% identical to V8's Math.${name}, worst ${worst} ulp`,
		);
	}
	const specials: [string, number, number][] = [
		["exp(0)", exp(0), 1],
		["exp(-inf)", exp(-Infinity), 0],
		["exp(inf)", exp(Infinity), Infinity],
		["exp(1000)", exp(1000), Infinity],
		["exp(-1000)", exp(-1000), 0],
		["log(1)", log(1), 0],
		["log(0)", log(0), -Infinity],
		["log(inf)", log(Infinity), Infinity],
		["log(min subnormal)", log(Number.MIN_VALUE), Math.log(Number.MIN_VALUE)],
	];
	for (const [what, got, want] of specials)
		if (!Object.is(got, want)) fail(`${what}: got ${got}, want ${want}`);
	if (!Number.isNaN(log(-1))) fail("log(-1) should be NaN");
}

// ---------- decimals ----------
{
	const D = (s: string, scale: number) => Decimal.parse(s, scale);
	const cases: [string, string][] = [
		[D("0.1", 2).add(D("0.2", 2)).toString(), "0.30"],
		[D("2.5", 1).rescale(0).toString(), "2"], // half-even: ties go to even
		[D("3.5", 1).rescale(0).toString(), "4"],
		[D("-2.5", 1).rescale(0).toString(), "-2"],
		[D("-3.5", 1).rescale(0).toString(), "-4"],
		[D("2.51", 2).rescale(0).toString(), "3"],
		[D("19.99", 2).mul(D("3", 0), 2).toString(), "59.97"],
		[
			D("200.00", 2).mul(D("5.0000", 4), 2).div(D("100", 0), 2).toString(),
			"10.00",
		],
		[
			D("50.00", 2).mul(D("100", 0), 4).div(D("200.00", 2), 4).toString(),
			"25.0000",
		], // the README's discount inverse
		[D("1", 0).div(D("3", 0), 4).toString(), "0.3333"],
		[D("2", 0).div(D("3", 0), 4).toString(), "0.6667"],
		[D("-0.004", 3).rescale(2).toString(), "0.00"], // never "-0.00"
		[Decimal.fromNumber(0.05, 4).toString(), "0.0500"],
		[Decimal.fromNumber(1e-7, 8).toString(), "0.00000010"],
		[Decimal.fromNumber(19.99, 2).toString(), "19.99"],
	];
	for (const [got, want] of cases)
		if (got !== want) fail(`decimal: got ${got}, want ${want}`);
	console.log(`Decimal: ${cases.length} rounding and formatting cases`);
}

if (failures > 0) {
	console.error(`${failures} failures`);
	process.exit(1);
}
console.log("all checks passed");
