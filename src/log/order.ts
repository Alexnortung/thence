const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const LAST = DIGITS[DIGITS.length - 1] as string;

/**
 * An order key strictly between two others (either may be missing for the
 * ends). Keys compare as plain strings, so two clients can each insert
 * between the same neighbours without talking to each other; a tie is broken
 * by element id.
 *
 * A key starts with a whole number, then an optional fraction. Its first
 * letter says how many digits follow: "a" one, "b" two, and so on, "Z" one,
 * "Y" two for the numbers below "a0". Adding at either end counts up or down,
 * so a list a row at a time keeps keys a few characters long; a new key
 * between two others takes their fractions.
 */
export function keyBetween(
	a: string | undefined,
	b: string | undefined,
): string {
	if (a === undefined && b === undefined) return "a0";
	if (b === undefined) return after(a as string);
	if (a === undefined) return before(b);
	const x = split(a);
	const y = split(b);
	// A key from elsewhere that isn't in this form still gets a key, only longer.
	if (!x || !y) return midpoint(a, b);
	if (x.whole === y.whole) return x.whole + midpoint(x.fraction, y.fraction);
	const up = increment(x.whole);
	return up !== undefined && up < b
		? up
		: x.whole + midpoint(x.fraction, undefined);
}

/**
 * A key's whole number and fraction. A fraction never ends in "0", so there
 * is always room for another key below it.
 */
function split(key: string): { whole: string; fraction: string } | undefined {
	const n = size(key[0] ?? "");
	if (
		n === undefined ||
		key.length < n ||
		(key.length > n && key.endsWith("0"))
	)
		return undefined;
	return { whole: key.slice(0, n), fraction: key.slice(n) };
}

/** How many characters the whole number at the start of a key takes, if its first letter says. */
function size(head: string): number | undefined {
	if (head >= "a" && head <= "z")
		return head.charCodeAt(0) - "a".charCodeAt(0) + 2;
	if (head >= "A" && head <= "Z")
		return "Z".charCodeAt(0) - head.charCodeAt(0) + 2;
	return undefined;
}

/** A key above `a`: its whole number, plus one. */
function after(a: string): string {
	const x = split(a);
	if (x) return increment(x.whole) ?? x.whole + midpoint(x.fraction, undefined);
	const head = a[0] ?? "";
	const n = size(head);
	// Below every whole number "a0" and up.
	if (n === undefined || head < "a") return "a0";
	// Missing digits read as the lowest, which is still at or above `a`.
	return increment(a.slice(0, n).padEnd(n, "0")) ?? midpoint(a, undefined);
}

/** A key below `b`: its whole number when it has a fraction, else that number less one. */
function before(b: string): string {
	const y = split(b);
	if (!y) return midpoint("", b);
	if (y.fraction) return y.whole;
	return decrement(y.whole) ?? midpoint("", b);
}

function increment(key: string): string | undefined {
	const digits = [...key.slice(1)];
	for (let i = digits.length - 1; i >= 0; i--) {
		if (digits[i] !== LAST) {
			digits[i] = DIGITS[DIGITS.indexOf(digits[i] as string) + 1] as string;
			return (key[0] as string) + digits.join("");
		}
		digits[i] = "0";
	}
	// Every digit was the highest: the next head, with its count of digits.
	const head = key[0] as string;
	if (head === "z") return undefined;
	if (head === "Z") return "a0";
	const next = String.fromCharCode(head.charCodeAt(0) + 1);
	return next + "0".repeat((size(next) as number) - 1);
}

function decrement(key: string): string | undefined {
	const digits = [...key.slice(1)];
	for (let i = digits.length - 1; i >= 0; i--) {
		if (digits[i] !== "0") {
			digits[i] = DIGITS[DIGITS.indexOf(digits[i] as string) - 1] as string;
			return (key[0] as string) + digits.join("");
		}
		digits[i] = LAST;
	}
	const head = key[0] as string;
	if (head === "A") return undefined;
	if (head === "a") return `Z${LAST}`;
	const next = String.fromCharCode(head.charCodeAt(0) - 1);
	return next + LAST.repeat((size(next) as number) - 1);
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
