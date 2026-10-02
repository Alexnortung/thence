const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * An order key strictly between two others (either may be missing for the
 * ends). Keys compare as plain strings, so two clients can each insert
 * between the same neighbours without talking to each other; a tie is broken
 * by element id.
 */
export function keyBetween(
	a: string | undefined,
	b: string | undefined,
): string {
	return midpoint(a ?? "", b);
}

function midpoint(a: string, b: string | undefined): string {
	if (b !== undefined) {
		let n = 0;
		while ((a[n] ?? "0") === b[n]) n++;
		if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
	}
	const da = a ? DIGITS.indexOf(a[0] as string) : 0;
	const db = b !== undefined ? DIGITS.indexOf(b[0] as string) : DIGITS.length;
	if (db - da > 1) return DIGITS[Math.round((da + db) / 2)] as string;
	if (b !== undefined && b.length > 1) return b.slice(0, 1);
	return (DIGITS[da] as string) + midpoint(a.slice(1), undefined);
}
