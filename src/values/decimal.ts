/**
 * An exact decimal: an integer number of units at a fixed scale, so 19.99 at
 * scale 2 is `1999n` units. Immutable.
 *
 * Every operation that can't be exact rounds once, half-even, to the scale of
 * its result. The receiver plays the first argument in the README's rule, so
 * `price.mul(rate)` has `price`'s scale unless you pass another one. A plain
 * number operand is read from its shortest decimal form, so `0.05` is exactly
 * 0.05.
 *
 * This is the type of a `t.decimal` value on handles and in your impls. Use
 * its methods for arithmetic; `toNumber()` is only for display.
 */
export class Decimal {
	readonly #units: bigint;
	/** Digits after the point; `Money` has 2. */
	readonly scale: number;

	private constructor(units: bigint, scale: number) {
		this.#units = units;
		this.scale = scale;
	}

	/**
	 * Reads `"19.99"`, `"-0.5"` or `"12"`, rounding half-even if the text has
	 * more digits than `scale`. `undefined` when the text isn't a decimal.
	 */
	static parse(text: string, scale: number): Decimal | undefined {
		checkScale(scale);
		const exact = Decimal.#parseExact(text);
		return exact?.rescale(scale);
	}

	/** A number, read from its shortest decimal form. Throws a `RangeError` for `NaN` and infinities. */
	static from(value: number, scale: number): Decimal {
		checkScale(scale);
		return Decimal.#fromNumber(value).rescale(scale);
	}

	add(other: Decimal | number, scale = this.scale): Decimal {
		const o = Decimal.#operand(other);
		const s = Math.max(this.scale, o.scale);
		return new Decimal(this.#at(s) + o.#at(s), s).rescale(scale);
	}

	sub(other: Decimal | number, scale = this.scale): Decimal {
		return this.add(Decimal.#operand(other).neg(), scale);
	}

	/** The exact product has scale `this.scale + other.scale`; it is rounded once. */
	mul(other: Decimal | number, scale = this.scale): Decimal {
		const o = Decimal.#operand(other);
		return new Decimal(this.#units * o.#units, this.scale + o.scale).rescale(
			scale,
		);
	}

	/** `undefined` when `other` is zero; a formula reports that as `div.zero`. */
	div(other: Decimal | number, scale = this.scale): Decimal | undefined {
		checkScale(scale);
		const o = Decimal.#operand(other);
		if (o.#units === 0n) return undefined;
		// (a / 10^as) / (b / 10^bs) at `scale` is a * 10^(scale + bs - as) / b units.
		const shift = scale + o.scale - this.scale;
		const n = shift >= 0 ? this.#units * pow10(shift) : this.#units;
		const d = shift >= 0 ? o.#units : o.#units * pow10(-shift);
		return new Decimal(divHalfEven(n, d), scale);
	}

	neg(): Decimal {
		return new Decimal(-this.#units, this.scale);
	}

	/** The same value at another scale, rounded half-even when the scale shrinks. */
	rescale(scale: number): Decimal {
		checkScale(scale);
		if (scale === this.scale) return this;
		return new Decimal(this.#at(scale), scale);
	}

	/** Compares values, not digits: 1.50 at scale 2 equals 1.5 at scale 1. */
	compare(other: Decimal): -1 | 0 | 1 {
		const s = Math.max(this.scale, other.scale);
		const a = this.#at(s);
		const b = other.#at(s);
		return a < b ? -1 : a > b ? 1 : 0;
	}

	equals(other: Decimal): boolean {
		return this.compare(other) === 0;
	}

	/** `"19.99"`: always `scale` digits after the point, and never `"-0.00"`. */
	toString(): string {
		const negative = this.#units < 0n;
		const digits = (negative ? -this.#units : this.#units)
			.toString()
			.padStart(this.scale + 1, "0");
		const point = digits.length - this.scale;
		const fraction = this.scale > 0 ? `.${digits.slice(point)}` : "";
		return (negative ? "-" : "") + digits.slice(0, point) + fraction;
	}

	/** The same as `toString()`, so a decimal is stored as `"19.99"`. */
	toJSON(): string {
		return this.toString();
	}

	/** The nearest double, for charts and display. Not for arithmetic. */
	toNumber(): number {
		return Number(this.toString());
	}

	/** Units at another scale, rounded half-even when the scale shrinks. */
	#at(scale: number): bigint {
		if (scale >= this.scale) return this.#units * pow10(scale - this.scale);
		return divHalfEven(this.#units, pow10(this.scale - scale));
	}

	static #operand(value: Decimal | number): Decimal {
		return typeof value === "number" ? Decimal.#fromNumber(value) : value;
	}

	/** Exactly the digits written, at as many places as they have. */
	static #parseExact(text: string): Decimal | undefined {
		const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text);
		if (!match) return undefined;
		const [, sign, whole = "", fraction = ""] = match;
		const units = BigInt(whole + fraction);
		return new Decimal(sign ? -units : units, fraction.length);
	}

	/** A number's shortest decimal form, `String(value)`, read exactly. */
	static #fromNumber(value: number): Decimal {
		if (!Number.isFinite(value)) throw new RangeError(`not finite: ${value}`);
		const [mantissa = "", exponent = "0"] = String(value).split("e");
		const d = Decimal.#parseExact(mantissa) as Decimal;
		const e = Number(exponent);
		if (e >= 0) return new Decimal(d.#units * pow10(e), d.scale);
		return new Decimal(d.#units, d.scale - e);
	}
}

function checkScale(scale: number): void {
	if (!Number.isSafeInteger(scale) || scale < 0)
		throw new RangeError(`scale must be a whole number from 0: ${scale}`);
}

const powers: bigint[] = [1n];

function pow10(n: number): bigint {
	for (let i = powers.length; i <= n; i++)
		powers[i] = (powers[i - 1] ?? 1n) * 10n;
	return powers[n] ?? 1n;
}

/** n / d rounded half-even. `d` is never zero. */
function divHalfEven(n: bigint, d: bigint): bigint {
	if (d < 0n) {
		n = -n;
		d = -d;
	}
	const q = n / d; // truncates toward zero
	const r = n % d; // has the sign of n
	const twice = (r < 0n ? -r : r) * 2n;
	if (twice < d || (twice === d && q % 2n === 0n)) return q;
	return n < 0n ? q - 1n : q + 1n;
}
