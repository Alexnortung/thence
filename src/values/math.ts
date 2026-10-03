// biome-ignore-all lint/correctness/noPrecisionLoss: constants are copied digit for digit from fdlibm, so they can be checked against its source
// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: same reason; fdlibm's invln2 happens to equal Math.LOG2E
/**
 * `thence/math`: functions of `Math` that JavaScript engines don't agree on,
 * ported from fdlibm (Sun Microsystems, 1993) so every engine gives the same
 * bits. They use only + - * / and bit operations, which every engine rounds
 * the same way, and behave like their `Math` namesakes, `NaN` included.
 *
 * The determinism spike found engines disagree on every `Math` function it
 * tried except `sqrt`, which IEEE 754 requires to be correctly rounded, so
 * `Math.sqrt` is safe to use. `exp` and `log` are here; `pow` is in pow.ts,
 * and `sin`, `cos` and `tan` in trig.ts.
 *
 * @module
 */

import { highWord, lowWord, withHighWord } from "./bits";

export { pow } from "./pow";
export { cos, sin, tan } from "./trig";

const ln2_hi = 6.9314718036912381649e-1;
const ln2_lo = 1.90821492927058770002e-10;

// ---------- exp ----------

const huge = 1.0e300;
const twom1000 = 9.3326361850321887899e-302; // 2^-1000
const oThreshold = 7.09782712893383973096e2;
const uThreshold = -7.4513321910194110842e2;
const invln2 = 1.442695040888963387;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.6533902205465251539e-6;
const P5 = 4.13813679705723846039e-8;
const two1023 = 8.98846567431157953865e307; // 2^1023

/** e to the power `x`, like `Math.exp`. */
export function exp(x: number): number {
	let hi = 0,
		lo = 0,
		k = 0;
	let hx = highWord(x);
	const xsb = (hx >>> 31) & 1;
	hx &= 0x7fffffff;

	if (hx >= 0x40862e42) {
		// |x| >= 709.78...
		if (hx >= 0x7ff00000) {
			if (((hx & 0xfffff) | lowWord(x)) !== 0) return x + x; // NaN
			return xsb === 0 ? x : 0; // exp(+-inf) = inf, 0
		}
		if (x > oThreshold) return huge * huge; // overflow
		if (x < uThreshold) return twom1000 * twom1000; // underflow
	}

	if (x === 1) return Math.E; // fdlibm is 1 ulp high here; Math.E is the correctly rounded e

	if (hx > 0x3fd62e42) {
		// |x| > 0.5 ln2
		if (hx < 0x3ff0a2b2) {
			// and |x| < 1.5 ln2
			hi = xsb === 0 ? x - ln2_hi : x + ln2_hi;
			lo = xsb === 0 ? ln2_lo : -ln2_lo;
			k = 1 - xsb - xsb;
		} else {
			k = Math.trunc(invln2 * x + (xsb === 0 ? 0.5 : -0.5));
			const t = k;
			hi = x - t * ln2_hi;
			lo = t * ln2_lo;
		}
		x = hi - lo;
	} else if (hx < 0x3e300000) {
		// |x| < 2^-28
		if (huge + x > 1) return 1 + x;
	} else {
		k = 0;
	}

	const t = x * x;
	const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
	if (k === 0) return 1 - ((x * c) / (c - 2.0) - x);
	const y = 1 - (lo - (x * c) / (2.0 - c) - hi);
	if (k >= -1021) {
		if (k === 1024) return y * 2.0 * two1023;
		return withHighWord(y, highWord(y) + (k << 20));
	}
	return withHighWord(y, highWord(y) + ((k + 1000) << 20)) * twom1000;
}

// ---------- log ----------

const two54 = 1.8014398509481984e16;
const Lg1 = 6.66666666666673513e-1;
const Lg2 = 3.999999999940941908e-1;
const Lg3 = 2.857142874366239149e-1;
const Lg4 = 2.222219843214978396e-1;
const Lg5 = 1.818357216161805012e-1;
const Lg6 = 1.531383769920937332e-1;
const Lg7 = 1.479819860511658591e-1;

/** The natural logarithm, like `Math.log`: `NaN` below 0 and `-Infinity` at 0. */
export function log(x: number): number {
	let hx = highWord(x);
	const lx = lowWord(x);
	let k = 0;

	if (hx < 0x00100000) {
		// x < 2^-1022
		if (((hx & 0x7fffffff) | lx) === 0) return -Infinity; // log(+-0)
		if (hx < 0) return NaN; // log(-#)
		k -= 54;
		x *= two54; // subnormal: scale up
		hx = highWord(x);
	}
	if (hx >= 0x7ff00000) return x + x;
	k += (hx >> 20) - 1023;
	hx &= 0x000fffff;
	let i = (hx + 0x95f64) & 0x100000;
	x = withHighWord(x, hx | (i ^ 0x3ff00000)); // normalize x or x/2
	k += i >> 20;
	const f = x - 1.0;

	if ((0x000fffff & (2 + hx)) < 3) {
		// -2^-20 <= f < 2^-20
		if (f === 0) {
			if (k === 0) return 0;
			const dk = k;
			return dk * ln2_hi + dk * ln2_lo;
		}
		const R = f * f * (0.5 - 0.33333333333333333 * f);
		if (k === 0) return f - R;
		const dk = k;
		return dk * ln2_hi - (R - dk * ln2_lo - f);
	}

	const s = f / (2.0 + f);
	const dk = k;
	const z = s * s;
	i = hx - 0x6147a;
	const w = z * z;
	const j = 0x6b851 - hx;
	const t1 = w * (Lg2 + w * (Lg4 + w * Lg6));
	const t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
	i |= j;
	const R = t2 + t1;
	if (i > 0) {
		const hfsq = 0.5 * f * f;
		if (k === 0) return f - (hfsq - s * (hfsq + R));
		return dk * ln2_hi - (hfsq - (s * (hfsq + R) + dk * ln2_lo) - f);
	}
	if (k === 0) return f - s * (f - R);
	return dk * ln2_hi - (s * (f - R) - dk * ln2_lo - f);
}
