// The harness: seeded inputs, our functions and the engine's Math.* on them, and one digest per function.
// The same bundle runs in Node and in each browser; equal digests mean bit-identical results.

import { fromWords, highWord, lowWord } from "./bits.js";
import { Decimal } from "./decimal.js";
import { ExactSum, fsum } from "./fsum.js";
import { exp, log } from "./math.js";

/** mulberry32: a small seeded generator built from 32-bit integer operations, identical everywhere. */
function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return (t ^ (t >>> 14)) >>> 0;
	};
}

/** A 64-bit FNV-1a over 32-bit words, kept as two lanes so it needs no BigInt. */
class Digest {
	private a = 0x811c9dc5;
	private b = 0x050c5d1f;
	count = 0;
	word(w: number) {
		this.a = Math.imul(this.a ^ (w >>> 0), 0x01000193) >>> 0;
		this.b = Math.imul(this.b ^ ((w >>> 0) ^ this.a), 0x01000193) >>> 0;
	}
	double(x: number) {
		this.word(highWord(x));
		this.word(lowWord(x));
		this.count++;
	}
	text(s: string) {
		for (let i = 0; i < s.length; i++) this.word(s.charCodeAt(i));
		this.word(0xffff);
		this.count++;
	}
	hex() {
		return (
			this.a.toString(16).padStart(8, "0") +
			this.b.toString(16).padStart(8, "0")
		);
	}
}

const N = 100_000;

/** Doubles spread over every exponent in [lo, hi], with random mantissas. */
function doubles(
	seed: number,
	n: number,
	expLo: number,
	expHi: number,
	sign: "pos" | "any",
) {
	const r = rng(seed);
	const out: number[] = [];
	for (let i = 0; i < n; i++) {
		const e = expLo + (r() % (expHi - expLo + 1));
		const hi = (((e + 1023) & 0x7ff) << 20) | (r() & 0xfffff);
		const neg = sign === "any" && (r() & 1) === 1;
		out.push(fromWords(neg ? hi | 0x80000000 : hi, r()));
	}
	return out;
}

export type Report = Record<string, { digest: string; count: number }>;

export function runHarness(): Report {
	const report: Report = {};
	const put = (name: string, d: Digest) => {
		report[name] = { digest: d.hex(), count: d.count };
	};

	// ---- transcendental functions: ours, and the engine's ----
	const expIn = doubles(1, N, -10, 9, "any").concat([
		0,
		-0,
		1,
		-1,
		709.78,
		-745.13,
		1e-300,
		0.5 * Math.LN2,
	]);
	const logIn = doubles(2, N, -1074 + 52, 1023, "pos").concat([
		1,
		2,
		0.5,
		Number.MIN_VALUE,
		Number.MAX_VALUE,
		1 + 2 ** -52,
	]);
	const trigIn = doubles(3, N, -30, 30, "any");
	const powX = doubles(4, N, -8, 8, "pos");
	const powY = doubles(5, N, -4, 4, "any");

	const run = (name: string, xs: number[], f: (x: number) => number) => {
		const d = new Digest();
		for (const x of xs) d.double(f(x));
		put(name, d);
	};
	run("thence.exp", expIn, exp);
	run("thence.log", logIn, log);
	run("Math.exp", expIn, Math.exp);
	run("Math.log", logIn, Math.log);
	run("Math.sin", trigIn, Math.sin);
	run("Math.cos", trigIn, Math.cos);
	run("Math.tan", trigIn, Math.tan);
	run("Math.atan", trigIn, Math.atan);
	run("Math.cbrt", trigIn, Math.cbrt);
	run("Math.expm1", expIn, Math.expm1);
	run("Math.log1p", logIn, Math.log1p);
	run("Math.sqrt", logIn, Math.sqrt); // IEEE requires sqrt to be exact: should always agree
	{
		const d = new Digest();
		for (let i = 0; i < N; i++) d.double(powX[i]! ** powY[i]!);
		put("Math.pow", d);
	}
	{
		const d = new Digest();
		for (let i = 0; i < N; i++) d.double(exp(powY[i]! * log(powX[i]!)));
		put("thence.exp(y*log(x))", d);
	}

	// ---- exact sums: one-shot, and incremental with removals ----
	{
		const r = rng(6);
		const d = new Digest();
		for (let k = 0; k < 2_000; k++) {
			const xs = doubles(1000 + k, 50, -60, 60, "any");
			d.double(fsum(xs));
			const acc = new ExactSum();
			for (const x of xs) acc.add(x);
			for (let i = 0; i < 20; i++) acc.remove(xs[r() % xs.length]!); // may remove values twice: still exact
			d.double(acc.value());
		}
		put("thence.fsum", d);
	}
	{
		const d = new Digest();
		for (let k = 0; k < 2_000; k++) {
			let s = 0;
			for (const x of doubles(1000 + k, 50, -60, 60, "any")) s += x;
			d.double(s);
		}
		put("naive float sum", d);
	}

	// ---- decimals ----
	{
		const r = rng(7);
		const d = new Digest();
		const dec = (scale: number) => {
			const units = (BigInt(r()) << 20n) ^ BigInt(r() & 0xfffff);
			return Decimal.of((r() & 1) === 1 ? -units : units, scale);
		};
		for (let i = 0; i < 20_000; i++) {
			const a = dec(2),
				b = dec(4);
			d.text(a.add(b).toString());
			d.text(a.mul(b, 2).toString());
			d.text(b.units === 0n ? "div.zero" : a.div(b, 4).toString());
			d.text(Decimal.fromNumber(Number(a.toString()), 2).toString());
		}
		put("thence.Decimal", d);
	}

	return report;
}

/** The engine's name, for reports. */
export function engine(): string {
	const g = globalThis as {
		navigator?: { userAgent?: string };
		process?: { version?: string };
	};
	return g.process?.version
		? `node ${g.process.version}`
		: (g.navigator?.userAgent ?? "unknown");
}
