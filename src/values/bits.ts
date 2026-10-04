// The two 32-bit words of a double, independent of the platform's byte order.

const view = new DataView(new ArrayBuffer(8));

export function highWord(x: number): number {
	view.setFloat64(0, x);
	return view.getInt32(0);
}

export function lowWord(x: number): number {
	view.setFloat64(0, x);
	return view.getUint32(4);
}

export function withHighWord(x: number, hi: number): number {
	view.setFloat64(0, x);
	view.setInt32(0, hi);
	return view.getFloat64(0);
}

export function withLowWord(x: number, lo: number): number {
	view.setFloat64(0, x);
	view.setUint32(4, lo >>> 0);
	return view.getFloat64(0);
}

export function fromWords(hi: number, lo: number): number {
	view.setInt32(0, hi);
	view.setUint32(4, lo >>> 0);
	return view.getFloat64(0);
}

/**
 * x × 2^n, rounded once, like C's `scalbn`. It multiplies by powers of two
 * built from their bits, so no engine's `**` is involved.
 */
export function scalbn(x: number, n: number): number {
	let y = x;
	if (n > 1023) {
		y *= twoTo(1023);
		n -= 1023;
		if (n > 1023) {
			y *= twoTo(1023);
			n -= 1023;
			if (n > 1023) n = 1023;
		}
	} else if (n < -1022) {
		// 2^-1022 × 2^53, so a subnormal result rounds only in the last step
		y *= twoTo(-1022 + 53);
		n += 1022 - 53;
		if (n < -1022) {
			y *= twoTo(-1022 + 53);
			n += 1022 - 53;
			if (n < -1022) n = -1022;
		}
	}
	return y * twoTo(n);
}

/** 2^n for -1022 <= n <= 1023, exactly. */
function twoTo(n: number): number {
	return fromWords((0x3ff + n) << 20, 0);
}
