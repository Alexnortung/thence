// The harness: seeded inputs, thence's functions and the engine's Math.* on
// them, and one digest per function. The same bundle runs in Node and in each
// browser; equal digests mean bit-identical results.

import { Decimal, ExactSum, fsum, math } from "../src/values";

/** mulberry32: a small seeded generator built from 32-bit integer operations, identical everywhere. */
function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return (t ^ (t >>> 14)) >>> 0;
	};
}

const view = new DataView(new ArrayBuffer(8));

/** A 64-bit FNV-1a over 32-bit words, kept as two lanes so it needs no BigInt. */
class Digest {
	#a = 0x811c9dc5;
	#b = 0x050c5d1f;
	count = 0;

	word(w: number): void {
		this.#a = Math.imul(this.#a ^ (w >>> 0), 0x01000193) >>> 0;
		this.#b = Math.imul(this.#b ^ (w >>> 0) ^ this.#a, 0x01000193) >>> 0;
	}

	double(x: number): void {
		view.setFloat64(0, x);
		this.word(view.getUint32(0));
		this.word(view.getUint32(4));
		this.count++;
	}

	text(s: string): void {
		for (let i = 0; i < s.length; i++) this.word(s.charCodeAt(i));
		this.word(0xffff);
		this.count++;
	}

	hex(): string {
		return (
			this.#a.toString(16).padStart(8, "0") +
			this.#b.toString(16).padStart(8, "0")
		);
	}
}

const N = 100_000;

/** Doubles spread over every exponent in [lo, hi], with random mantissas. */
function doubles(
	seed: number,
	n: number,
	lo: number,
	hi: number,
	sign: "pos" | "any",
): number[] {
	const r = rng(seed);
	const out: number[] = [];
	for (let i = 0; i < n; i++) {
		const e = lo + (r() % (hi - lo + 1));
		const high = (((e + 1023) & 0x7ff) << 20) | (r() & 0xfffff);
		const neg = sign === "any" && (r() & 1) === 1;
		view.setInt32(0, neg ? high | 0x80000000 : high);
		view.setUint32(4, r());
		out.push(view.getFloat64(0));
	}
	return out;
}

/** One digest per function, by name: `thence.*` must agree everywhere, `Math.*` is for comparison. */
export type Report = Record<string, { digest: string; count: number }>;

export function runHarness(): Report {
	const report: Report = {};
	const run = (name: string, f: (d: Digest) => void) => {
		const d = new Digest();
		f(d);
		report[name] = { digest: d.hex(), count: d.count };
	};
	const each = (xs: number[], f: (x: number) => number) => (d: Digest) => {
		for (const x of xs) d.double(f(x));
	};

	const special = [
		0,
		-0,
		1,
		-1,
		0.5,
		-0.5,
		2,
		Number.MIN_VALUE,
		Number.MAX_VALUE,
	];
	const expIn = doubles(1, N, -10, 9, "any").concat(special, [709.78, -745.13]);
	const logIn = doubles(2, N, -1022, 1023, "pos").concat(special);
	// small, medium and huge arguments take different reductions
	const trigIn = doubles(3, N, -30, 30, "any").concat(
		doubles(4, N / 10, 30, 1023, "any"),
		special,
		[Math.PI / 2, Math.PI, 1e22],
	);
	const powX = doubles(5, N, -8, 8, "any");
	const powY = doubles(6, N, -4, 6, "any").map((y, i) =>
		// a negative base needs an integer power
		(powX[i] as number) < 0 ? Math.round(y) : y,
	);
	const pow = (f: (x: number, y: number) => number) => (d: Digest) => {
		for (let i = 0; i < N; i++)
			d.double(f(powX[i] as number, powY[i] as number));
		for (const x of special) for (const y of special) d.double(f(x, y));
	};

	run("thence.exp", each(expIn, math.exp));
	run("thence.log", each(logIn, math.log));
	run("thence.pow", pow(math.pow));
	run("thence.sin", each(trigIn, math.sin));
	run("thence.cos", each(trigIn, math.cos));
	run("thence.tan", each(trigIn, math.tan));
	run("Math.exp", each(expIn, Math.exp));
	run("Math.log", each(logIn, Math.log));
	run("Math.pow", pow(Math.pow));
	run("Math.sin", each(trigIn, Math.sin));
	run("Math.cos", each(trigIn, Math.cos));
	run("Math.tan", each(trigIn, Math.tan));

	run("thence.fsum", (d) => {
		const r = rng(7);
		for (let k = 0; k < 2_000; k++) {
			const xs = doubles(1000 + k, 50, -60, 60, "any");
			d.double(fsum(xs));
			const acc = new ExactSum();
			for (const x of xs) acc.add(x);
			for (let i = 0; i < 20; i++) acc.remove(xs[r() % xs.length] as number);
			d.double(acc.value());
		}
	});

	run("thence.Decimal", (d) => {
		const r = rng(8);
		const dec = (scale: number) => {
			const units = (BigInt(r()) << 20n) ^ BigInt(r() & 0xfffff);
			const digits = units.toString().padStart(scale + 1, "0");
			const sign = (r() & 1) === 1 ? "-" : "";
			const text = `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
			return Decimal.parse(text, scale) as Decimal;
		};
		for (let i = 0; i < 20_000; i++) {
			const a = dec(2);
			const b = dec(4);
			d.text(a.add(b).toString());
			d.text(a.mul(b, 2).toString());
			d.text(a.div(b, 4)?.toString() ?? "div.zero");
			d.text(Decimal.from(a.toNumber(), 2).toString());
		}
	});

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
