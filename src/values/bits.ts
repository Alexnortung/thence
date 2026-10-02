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
