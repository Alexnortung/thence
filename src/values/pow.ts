// biome-ignore-all lint/correctness/noPrecisionLoss: constants are copied digit for digit from fdlibm, so they can be checked against its source
// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: same reason; fdlibm's ivln2 happens to equal Math.LOG2E

/*
 * Ported from fdlibm's e_pow.c, as FreeBSD's msun and openlibm keep it,
 * without their shortcuts for y = 3 and 4:
 *
 * ====================================================
 * Copyright (C) 2004 by Sun Microsystems, Inc. All rights reserved.
 *
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 */

import { fromWords, highWord, lowWord, scalbn, withLowWord } from "./bits";

const bp = [1.0, 1.5];
const dp_h = [0.0, 5.84962487220764160156e-1]; // 0x3FE2B803, 0x40000000
const dp_l = [0.0, 1.35003920212974897128e-8]; // 0x3E4CFDEB, 0x43CFD006
const two53 = 9007199254740992.0;
const huge = 1.0e300;
const tiny = 1.0e-300;
// poly coefs for (3/2)*(log(x)-2s-2/3*s**3
const L1 = 5.99999999999994648725e-1;
const L2 = 4.28571428578550184252e-1;
const L3 = 3.33333329818377432918e-1;
const L4 = 2.72728123808534006489e-1;
const L5 = 2.30660745775561754067e-1;
const L6 = 2.06975017800338417784e-1;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.6533902205465251539e-6;
const P5 = 4.13813679705723846039e-8;
const lg2 = 6.93147180559945286227e-1;
const lg2_h = 6.93147182464599609375e-1; // 0x3FE62E43, 0x00000000
const lg2_l = -1.90465429995776804525e-9;
const ovt = 8.0085662595372944372e-17; // -(1024-log2(ovfl+.5ulp))
const cp = 9.61796693925975554329e-1; // 2/(3ln2)
const cp_h = 9.61796700954437255859e-1; // (float)cp
const cp_l = -7.02846165095275826516e-9; // tail of cp_h
const ivln2 = 1.442695040888963387; // 1/ln2
const ivln2_h = 1.44269502162933349609; // 24b 1/ln2
const ivln2_l = 1.92596299112661746887e-8; // 1/ln2 tail

/**
 * `x` to the power `y`, like `Math.pow` and `**`: `NaN` whenever `y` is,
 * and for `(±1) ** ±Infinity`, where C's `pow` gives 1. An integer power of
 * an integer is exact when it fits.
 */
export function pow(x: number, y: number): number {
	const hx = highWord(x);
	const lx = lowWord(x);
	const hy = highWord(y);
	const ly = lowWord(y);
	let ix = hx & 0x7fffffff;
	const iy = hy & 0x7fffffff;

	// y == 0: x**0 = 1, even for NaN
	if ((iy | ly) === 0) return 1;
	// NaN on either side; JavaScript, unlike C, gives NaN for 1**NaN too
	if (
		ix > 0x7ff00000 ||
		(ix === 0x7ff00000 && lx !== 0) ||
		iy > 0x7ff00000 ||
		(iy === 0x7ff00000 && ly !== 0)
	) {
		return Number.NaN;
	}

	// yisint: 0 when y isn't an integer, 1 for an odd one, 2 for an even one, when x < 0
	let yisint = 0;
	if (hx < 0) {
		if (iy >= 0x43400000) yisint = 2;
		else if (iy >= 0x3ff00000) {
			const k = (iy >> 20) - 0x3ff;
			if (k > 20) {
				const j = ly >>> (52 - k);
				if ((j << (52 - k)) >>> 0 === ly) yisint = 2 - (j & 1);
			} else if (ly === 0) {
				const j = iy >> (20 - k);
				if (j << (20 - k) === iy) yisint = 2 - (j & 1);
			}
		}
	}

	// special values of y
	if (ly === 0) {
		if (iy === 0x7ff00000) {
			// y is +-inf
			if (((ix - 0x3ff00000) | lx) === 0) return Number.NaN; // (+-1)**+-inf, NaN in JavaScript
			if (ix >= 0x3ff00000) return hy >= 0 ? y : 0; // (|x|>1)**+-inf = inf,0
			return hy < 0 ? -y : 0; // (|x|<1)**-,+inf = inf,0
		}
		if (iy === 0x3ff00000) return hy < 0 ? 1 / x : x; // y is +-1
		// y is 2. openlibm also shortcuts 3 and 4, which rounds twice, so
		// those take the full path here, as in fdlibm 5.3.
		if (hy === 0x40000000) return x * x;
		// y is 0.5 and x >= +0; sqrt is correctly rounded in every engine
		if (hy === 0x3fe00000 && hx >= 0) return Math.sqrt(x);
	}

	// x == 1: 1**y = 1
	if (hx === 0x3ff00000 && lx === 0) return 1;

	let ax = Math.abs(x);
	// special values of x
	if (lx === 0) {
		if (ix === 0x7ff00000 || ix === 0 || ix === 0x3ff00000) {
			let z = ax; // x is +-0,+-inf,+-1
			if (hy < 0) z = 1 / z;
			if (hx < 0) {
				if (((ix - 0x3ff00000) | yisint) === 0) {
					z = Number.NaN; // (-1)**non-int
				} else if (yisint === 1) z = -z; // (x<0)**odd = -(|x|**odd)
			}
			return z;
		}
	}

	let n = (hx >>> 31) - 1;
	// (x<0)**(non-int) is NaN
	if ((n | yisint) === 0) return Number.NaN;

	let s = 1; // sign of the result: -1 for (-ve)**(odd int)
	if ((n | (yisint - 1)) === 0) s = -1;

	let t1: number;
	let t2: number;
	if (iy > 0x41e00000) {
		// |y| > 2**31
		if (iy > 0x43f00000) {
			// |y| > 2**64, must over- or underflow
			if (ix <= 0x3fefffff) return hy < 0 ? huge * huge : tiny * tiny;
			if (ix >= 0x3ff00000) return hy > 0 ? huge * huge : tiny * tiny;
		}
		// over- or underflow if x isn't close to one
		if (ix < 0x3fefffff) return hy < 0 ? s * huge * huge : s * tiny * tiny;
		if (ix > 0x3ff00000) return hy > 0 ? s * huge * huge : s * tiny * tiny;
		// now |1-x| <= 2**-20, enough to compute log(x) by x-x^2/2+x^3/3-x^4/4
		const t = ax - 1; // t has 20 trailing zeros
		const w = t * t * (0.5 - t * (0.3333333333333333333333 - t * 0.25));
		const u = ivln2_h * t; // ivln2_h has 21 sig. bits
		const v = t * ivln2_l - w * ivln2;
		t1 = withLowWord(u + v, 0);
		t2 = v - (t1 - u);
	} else {
		n = 0;
		// subnormal x
		if (ix < 0x00100000) {
			ax *= two53;
			n -= 53;
			ix = highWord(ax);
		}
		n += (ix >> 20) - 0x3ff;
		const j = ix & 0x000fffff;
		// determine the interval
		ix = j | 0x3ff00000; // normalize ix
		let k: number;
		if (j <= 0x3988e)
			k = 0; // |x|<sqrt(3/2)
		else if (j < 0xbb67a)
			k = 1; // |x|<sqrt(3)
		else {
			k = 0;
			n += 1;
			ix -= 0x00100000;
		}
		ax = fromWords(ix, lowWord(ax));

		// ss = s_h+s_l = (x-1)/(x+1) or (x-1.5)/(x+1.5)
		const bpk = bp[k] as number;
		let u = ax - bpk;
		let v = 1 / (ax + bpk);
		const ss = u * v;
		const s_h = withLowWord(ss, 0);
		// t_h = ax+bp[k] high
		let t_h = fromWords(((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18), 0);
		let t_l = ax - (t_h - bpk);
		const s_l = v * (u - s_h * t_h - s_h * t_l);
		// log(ax)
		let s2 = ss * ss;
		let r =
			s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
		r += s_l * (s_h + ss);
		s2 = s_h * s_h;
		t_h = withLowWord(3.0 + s2 + r, 0);
		t_l = r - (t_h - 3.0 - s2);
		// u+v = ss*(1+...)
		u = s_h * t_h;
		v = s_l * t_h + t_l * ss;
		// 2/(3log2)*(ss+...)
		const p_h = withLowWord(u + v, 0);
		const p_l = v - (p_h - u);
		const z_h = cp_h * p_h; // cp_h+cp_l = 2/(3*log2)
		const z_l = cp_l * p_h + p_l * cp + (dp_l[k] as number);
		// log2(ax) = (ss+..)*2/(3*log2) = n + dp_h + z_h + z_l
		const t = n;
		const dph = dp_h[k] as number;
		t1 = withLowWord(z_h + z_l + dph + t, 0);
		t2 = z_l - (t1 - t - dph - z_h);
	}

	// split y into y1+y2 and compute (y1+y2)*(t1+t2)
	const y1 = withLowWord(y, 0);
	const p_l = (y - y1) * t1 + y * t2;
	let p_h = y1 * t1;
	let z = p_l + p_h;
	let j = highWord(z);
	let i = lowWord(z);
	if (j >= 0x40900000) {
		// z >= 1024
		if (j !== 0x40900000 || i !== 0) return s * huge * huge; // z > 1024
		if (p_l + ovt > z - p_h) return s * huge * huge;
	} else if ((j & 0x7fffffff) >= 0x4090cc00) {
		// z <= -1075
		if (j >>> 0 !== 0xc090cc00 || i !== 0) return s * tiny * tiny; // z < -1075
		if (p_l <= z - p_h) return s * tiny * tiny;
	}

	// 2**(p_h+p_l)
	i = j & 0x7fffffff;
	let k = (i >> 20) - 0x3ff;
	n = 0;
	if (i > 0x3fe00000) {
		// |z| > 0.5: n = [z+0.5]
		n = j + (0x00100000 >> (k + 1));
		k = ((n & 0x7fffffff) >> 20) - 0x3ff; // new k for n
		const t = fromWords(n & ~(0x000fffff >> k), 0);
		n = ((n & 0x000fffff) | 0x00100000) >> (20 - k);
		if (j < 0) n = -n;
		p_h -= t;
	}
	const t = withLowWord(p_l + p_h, 0);
	const u = t * lg2_h;
	const v = (p_l - (t - p_h)) * lg2 + t * lg2_l;
	z = u + v;
	const w = v - (z - u);
	const tt = z * z;
	const tz = z - tt * (P1 + tt * (P2 + tt * (P3 + tt * (P4 + tt * P5))));
	const r = (z * tz) / (tz - 2) - (w + z * w);
	z = 1 - (r - z);
	j = highWord(z) + (n << 20);
	if (j >> 20 <= 0)
		z = scalbn(z, n); // subnormal result
	else z = fromWords(j, lowWord(z));
	return s * z;
}
