// biome-ignore-all lint/correctness/noPrecisionLoss: constants are copied digit for digit from fdlibm, so they can be checked against its source

/*
 * Ported from fdlibm's s_sin.c, s_cos.c, s_tan.c, k_sin.c, k_cos.c,
 * k_tan.c, e_rem_pio2.c and k_rem_pio2.c, as FreeBSD's msun and openlibm
 * keep them:
 *
 * ====================================================
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 *
 * Developed at SunPro, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 */

import { fromWords, highWord, lowWord, scalbn, withLowWord } from "./bits";

/** The sine of `x` radians, like `Math.sin`. */
export function sin(x: number): number {
	const ix = highWord(x) & 0x7fffffff;
	if (ix <= 0x3fe921fb) {
		// |x| ~< pi/4
		if (ix < 0x3e500000) return x; // |x| < 2**-26
		return kernelSin(x, 0, false);
	}
	if (ix >= 0x7ff00000) return Number.NaN; // sin(Inf or NaN)
	const [n, y0, y1] = remPio2(x);
	switch (n & 3) {
		case 0:
			return kernelSin(y0, y1, true);
		case 1:
			return kernelCos(y0, y1);
		case 2:
			return -kernelSin(y0, y1, true);
		default:
			return -kernelCos(y0, y1);
	}
}

/** The cosine of `x` radians, like `Math.cos`. */
export function cos(x: number): number {
	const ix = highWord(x) & 0x7fffffff;
	if (ix <= 0x3fe921fb) {
		// |x| ~< pi/4
		if (ix < 0x3e46a09e) return 1; // |x| < 2**-27 * sqrt(2)
		return kernelCos(x, 0);
	}
	if (ix >= 0x7ff00000) return Number.NaN; // cos(Inf or NaN)
	const [n, y0, y1] = remPio2(x);
	switch (n & 3) {
		case 0:
			return kernelCos(y0, y1);
		case 1:
			return -kernelSin(y0, y1, true);
		case 2:
			return -kernelCos(y0, y1);
		default:
			return kernelSin(y0, y1, true);
	}
}

/** The tangent of `x` radians, like `Math.tan`. */
export function tan(x: number): number {
	const ix = highWord(x) & 0x7fffffff;
	if (ix <= 0x3fe921fb) {
		// |x| ~< pi/4
		if (ix < 0x3e400000) return x; // |x| < 2**-27
		return kernelTan(x, 0, 1);
	}
	if (ix >= 0x7ff00000) return Number.NaN; // tan(Inf or NaN)
	const [n, y0, y1] = remPio2(x);
	return kernelTan(y0, y1, (n & 1) === 0 ? 1 : -1);
}

// ---------- kernels on [-pi/4, pi/4]; y is the tail of x ----------

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

/** sin(x+y); `tail` says whether y is used at all. */
function kernelSin(x: number, y: number, tail: boolean): number {
	const z = x * x;
	const w = z * z;
	const r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6);
	const v = z * x;
	if (!tail) return x + v * (S1 + z * r);
	return x - (z * (0.5 * y - v * r) - y - v * S1);
}

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.0875723212981748279e-9;
const C6 = -1.13596475577881948265e-11;

/** cos(x+y). */
function kernelCos(x: number, y: number): number {
	const z = x * x;
	let w = z * z;
	const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
	const hz = 0.5 * z;
	w = 1 - hz;
	return w + (1 - w - hz + (z * r - x * y));
}

const T = [
	3.33333333333334091986e-1, 1.33333333333201242699e-1,
	5.39682539762260521377e-2, 2.18694882948595424599e-2,
	8.86323982359930005737e-3, 3.59207910759131235356e-3,
	1.45620945432529025516e-3, 5.88041240820264096874e-4,
	2.46463134818469906812e-4, 7.817944429395570923e-5, 7.14072491382608190305e-5,
	-1.85586374855275456654e-5, 2.59073051863633712884e-5,
] as const;
const pio4 = 7.85398163397448278999e-1;
const pio4lo = 3.06161699786838301793e-17;

/** tan(x+y) when `k` is 1, -1/tan(x+y) when it is -1. */
function kernelTan(x: number, y: number, k: 1 | -1): number {
	const hx = highWord(x);
	const ix = hx & 0x7fffffff;
	const big = ix >= 0x3fe59428; // |x| >= 0.6744
	if (big) {
		if (hx < 0) {
			x = -x;
			y = -y;
		}
		x = pio4 - x + (pio4lo - y);
		y = 0;
	}
	let z = x * x;
	let w = z * z;
	// x^5*(T1+x^4*T3+...+x^20*T11) + x^5*(x^2*(T2+x^4*T4+...+x^22*T12))
	let r = T[1] + w * (T[3] + w * (T[5] + w * (T[7] + w * (T[9] + w * T[11]))));
	let v =
		z * (T[2] + w * (T[4] + w * (T[6] + w * (T[8] + w * (T[10] + w * T[12])))));
	let s = z * x;
	r = y + z * (s * (r + v) + y);
	r += T[0] * s;
	w = x + r;
	if (big) {
		v = k;
		return (1 - ((hx >> 30) & 2)) * (v - 2.0 * (x - ((w * w) / (w + v) - r)));
	}
	if (k === 1) return w;
	// -1/(x+r), accurately
	z = withLowWord(w, 0);
	v = r - (z - x); // z+v = r+x
	const a = -1.0 / w;
	const t = withLowWord(a, 0);
	s = 1.0 + t * z;
	return t + a * (s + t * v);
}

// ---------- argument reduction: x - n*pi/2 as y0 + y1 ----------

const invpio2 = 6.36619772367581382433e-1; // 53 bits of 2/pi
const pio2_1 = 1.57079632673412561417; // first 33 bits of pi/2
const pio2_1t = 6.07710050650619224932e-11; // pi/2 - pio2_1
const pio2_2 = 6.0771005063039659766e-11; // second 33 bits of pi/2
const pio2_2t = 2.02226624879595063154e-21; // pi/2 - (pio2_1+pio2_2)
const pio2_3 = 2.0222662487111664558e-21; // third 33 bits of pi/2
const pio2_3t = 8.47842766036889956997e-32; // pi/2 - (pio2_1+pio2_2+pio2_3)
const two24 = 1.6777216e7;
const toInt = 6755399441055744; // 0x1.8p52: adding it rounds to an integer

/** n, and x - n*pi/2 as y0 + y1 within pi/4 of zero, for |x| > pi/4. */
function remPio2(x: number): [n: number, y0: number, y1: number] {
	const hx = highWord(x);
	const ix = hx & 0x7fffffff;
	// Near a multiple of pi/2 the medium case keeps more bits.
	const near =
		(ix <= 0x400f6a7a && (ix & 0xfffff) === 0x921fb) ||
		ix === 0x4012d97c ||
		ix === 0x401921fb;
	if (!near && ix <= 0x401c463b) {
		// |x| ~<= 9pi/4: subtract a small multiple of pi/2 directly
		const k =
			ix <= 0x4002d97c ? 1 : ix <= 0x400f6a7a ? 2 : ix <= 0x4015fdbc ? 3 : 4;
		const sign = hx > 0 ? 1 : -1;
		const z = x - sign * k * pio2_1;
		const y0 = z - sign * k * pio2_1t;
		const y1 = z - y0 - sign * k * pio2_1t;
		return [sign * k, y0, y1];
	}

	if (ix < 0x413921fb) {
		// |x| ~< 2^20*(pi/2), medium size
		const fn = x * invpio2 + toInt - toInt;
		const n = fn | 0;
		let r = x - fn * pio2_1;
		let w = fn * pio2_1t; // first round, good to 85 bits
		const j = ix >> 20;
		let y0 = r - w;
		let i = j - ((highWord(y0) >> 20) & 0x7ff);
		if (i > 16) {
			// second iteration, good to 118 bits
			let t = r;
			w = fn * pio2_2;
			r = t - w;
			w = fn * pio2_2t - (t - r - w);
			y0 = r - w;
			i = j - ((highWord(y0) >> 20) & 0x7ff);
			if (i > 49) {
				// third iteration, 151 bits, covers every case
				t = r;
				w = fn * pio2_3;
				r = t - w;
				w = fn * pio2_3t - (t - r - w);
				y0 = r - w;
			}
		}
		return [n, y0, r - y0 - w];
	}

	// Large arguments: split |x| into three 24-bit pieces, z = scalbn(|x|, ilogb(x)-23).
	const e0 = (ix >> 20) - 1046;
	let z = fromWords(ix - (e0 << 20), lowWord(x));
	const tx = [0, 0, 0];
	for (let i = 0; i < 2; i++) {
		tx[i] = Math.trunc(z);
		z = (z - (tx[i] as number)) * two24;
	}
	tx[2] = z;
	let nx = 3;
	while (tx[nx - 1] === 0) nx--; // skip zero terms
	const [n, y0, y1] = kernelRemPio2(tx, e0, nx);
	return hx < 0 ? [-n, -y0, -y1] : [n, y0, y1];
}

/** 2/pi in 24-bit pieces: ipio2[i] * 2^(-24(i+1)). Double precision needs 66. */
const ipio2 = [
	0xa2f983, 0x6e4e44, 0x1529fc, 0x2757d1, 0xf534dd, 0xc0db62, 0x95993c,
	0x439041, 0xfe5163, 0xabdebb, 0xc561b7, 0x246e3a, 0x424dd2, 0xe00649,
	0x2eea09, 0xd1921c, 0xfe1deb, 0x1cb129, 0xa73ee8, 0x8235f5, 0x2ebb44,
	0x84e99c, 0x7026b4, 0x5f7e41, 0x3991d6, 0x398353, 0x39f49c, 0x845f8b,
	0xbdf928, 0x3b1ff8, 0x97ffde, 0x05980f, 0xef2f11, 0x8b5a0a, 0x6d1f6d,
	0x367ecf, 0x27cb09, 0xb74f46, 0x3f669e, 0x5fea2d, 0x7527ba, 0xc7ebe5,
	0xf17b3d, 0x0739f7, 0x8a5292, 0xea6bfb, 0x5fb11f, 0x8d5d08, 0x560330,
	0x46fc7b, 0x6babf0, 0xcfbc20, 0x9af436, 0x1da9e3, 0x91615e, 0xe61b08,
	0x659985, 0x5f14a0, 0x68408d, 0xffd880, 0x4d7327, 0x310606, 0x1556ca,
	0x73a8c9, 0x60e27b, 0xc08c6b,
];

/** pi/2 in 24-bit pieces. */
const PIo2 = [
	1.57079625129699707031, 7.54978941586159635335e-8, 5.39030252995776476554e-15,
	3.28200341580791294123e-22, 1.27065575308067607349e-29,
	1.22933308981111328932e-36, 2.73370053816464559624e-44,
	2.16741683877804819444e-51,
];

const twon24 = 5.9604644775390625e-8;

/**
 * x rem pi/2 for a large x, given as nx 24-bit pieces scaled by 2^-e0: n
 * mod 8, and the remainder as y0 + y1. fdlibm's `__kernel_rem_pio2` with
 * `prec` 1 (53 bits), so jk is 4.
 */
function kernelRemPio2(
	x: readonly number[],
	e0: number,
	nx: number,
): [n: number, y0: number, y1: number] {
	const jk = 4;
	const jp = jk;
	const jx = nx - 1;
	const jv = Math.max(0, Math.trunc((e0 - 3) / 24));
	let q0 = e0 - 24 * (jv + 1);
	const at = (a: readonly number[], i: number) => a[i] as number;

	// f[0] to f[jx+jk], where f[jx+jk] = ipio2[jv+jk]
	const f: number[] = [];
	for (let i = 0, j = jv - jx; i <= jx + jk; i++, j++) {
		f[i] = j < 0 ? 0 : at(ipio2, j);
	}
	// q[0] to q[jk]
	const q: number[] = [];
	for (let i = 0; i <= jk; i++) {
		let fw = 0;
		for (let j = 0; j <= jx; j++) fw += at(x, j) * at(f, jx + i - j);
		q[i] = fw;
	}

	let jz = jk;
	const iq: number[] = [];
	let z: number;
	let n: number;
	let ih: number;
	for (;;) {
		// distill q[] into iq[], in reverse
		z = at(q, jz);
		for (let i = 0, j = jz; j > 0; i++, j--) {
			const fw = Math.trunc(twon24 * z);
			iq[i] = Math.trunc(z - two24 * fw);
			z = at(q, j - 1) + fw;
		}

		// n
		z = scalbn(z, q0);
		z -= 8.0 * Math.floor(z * 0.125); // trim off the integer >= 8
		n = Math.trunc(z);
		z -= n;
		ih = 0;
		if (q0 > 0) {
			// iq[jz-1] is needed to determine n
			const i = at(iq, jz - 1) >> (24 - q0);
			n += i;
			iq[jz - 1] = at(iq, jz - 1) - (i << (24 - q0));
			ih = at(iq, jz - 1) >> (23 - q0);
		} else if (q0 === 0) ih = at(iq, jz - 1) >> 23;
		else if (z >= 0.5) ih = 2;

		if (ih > 0) {
			// q > 0.5
			n += 1;
			let carry = 0;
			for (let i = 0; i < jz; i++) {
				// 1 - q
				const j = at(iq, i);
				if (carry === 0) {
					if (j !== 0) {
						carry = 1;
						iq[i] = 0x1000000 - j;
					}
				} else iq[i] = 0xffffff - j;
			}
			if (q0 === 1) iq[jz - 1] = at(iq, jz - 1) & 0x7fffff;
			else if (q0 === 2) iq[jz - 1] = at(iq, jz - 1) & 0x3fffff;
			if (ih === 2) {
				z = 1 - z;
				if (carry !== 0) z -= scalbn(1, q0);
			}
		}

		// recompute with more terms if the bits so far cancel out
		if (z !== 0) break;
		let j = 0;
		for (let i = jz - 1; i >= jk; i--) j |= at(iq, i);
		if (j !== 0) break;
		let k = 1;
		while (at(iq, jk - k) === 0) k++; // k = number of terms needed
		for (let i = jz + 1; i <= jz + k; i++) {
			f[jx + i] = at(ipio2, jv + i);
			let fw = 0;
			for (let j = 0; j <= jx; j++) fw += at(x, j) * at(f, jx + i - j);
			q[i] = fw;
		}
		jz += k;
	}

	// chop off zero terms
	if (z === 0) {
		jz -= 1;
		q0 -= 24;
		while (at(iq, jz) === 0) {
			jz--;
			q0 -= 24;
		}
	} else {
		// break z into 24 bits if needed
		z = scalbn(z, -q0);
		if (z >= two24) {
			const fw = Math.trunc(twon24 * z);
			iq[jz] = Math.trunc(z - two24 * fw);
			jz += 1;
			q0 += 24;
			iq[jz] = fw;
		} else iq[jz] = Math.trunc(z);
	}

	// the integer chunks as floating-point values
	let fw = scalbn(1, q0);
	for (let i = jz; i >= 0; i--) {
		q[i] = fw * at(iq, i);
		fw *= twon24;
	}

	// PIo2[0..jp] * q[jz..0]
	const fq: number[] = [];
	for (let i = jz; i >= 0; i--) {
		let sum = 0;
		for (let k = 0; k <= jp && k <= jz - i; k++) {
			sum += at(PIo2, k) * at(q, i + k);
		}
		fq[jz - i] = sum;
	}

	// compress fq[] into y0 + y1
	let sum = 0;
	for (let i = jz; i >= 0; i--) sum += at(fq, i);
	const y0 = ih === 0 ? sum : -sum;
	sum = at(fq, 0) - sum;
	for (let i = 1; i <= jz; i++) sum += at(fq, i);
	const y1 = ih === 0 ? sum : -sum;
	return [n & 7, y0, y1];
}
