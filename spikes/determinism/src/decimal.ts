// An exact decimal: an integer number of units at a fixed scale, so 19.99 at scale 2 is 1999n.
// Every operation that can't be exact rounds half-even to the scale it is asked for.

const TEN = 10n;
const pow10Cache: bigint[] = [1n];

function pow10(n: number): bigint {
	for (let i = pow10Cache.length; i <= n; i++)
		pow10Cache[i] = pow10Cache[i - 1]! * TEN;
	return pow10Cache[n]!;
}

/** n / d rounded half-even. d is never zero. */
function divHalfEven(n: bigint, d: bigint): bigint {
	if (d < 0n) {
		n = -n;
		d = -d;
	}
	const q = n / d; // truncates toward zero
	const r = n % d; // same sign as n
	const twice = (r < 0n ? -r : r) * 2n;
	if (twice < d) return q;
	if (twice > d || q % 2n !== 0n) return n < 0n ? q - 1n : q + 1n;
	return q; // a tie, and q is already even
}

export class Decimal {
	private constructor(
		readonly units: bigint,
		readonly scale: number,
	) {}

	static of(units: bigint, scale: number): Decimal {
		if (!Number.isInteger(scale) || scale < 0)
			throw new RangeError(`bad scale ${scale}`);
		return new Decimal(units, scale);
	}

	/** Reads "19.99", "-0.5" or "12". Rounds half-even if the text has more digits than the scale. */
	static parse(text: string, scale: number): Decimal {
		const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text);
		if (!m) throw new SyntaxError(`not a decimal: ${JSON.stringify(text)}`);
		const frac = m[3] ?? "";
		const digits = BigInt(m[2]! + frac);
		const signed = m[1] ? -digits : digits;
		return Decimal.of(signed, frac.length).rescale(scale);
	}

	/** A JSON number literal, read from its shortest decimal form, so 0.05 is exactly 0.05. */
	static fromNumber(x: number, scale: number): Decimal {
		if (!Number.isFinite(x)) throw new RangeError(`not finite: ${x}`);
		const s = String(x);
		if (/e/i.test(s)) {
			const [mant, exp] = s.split(/e/i) as [string, string];
			const d = Decimal.parse(mant.replace(/^\+/, ""), 20);
			const e = Number(exp);
			const units = e >= 0 ? d.units * pow10(e) : d.units;
			const sc = e >= 0 ? d.scale : d.scale - e;
			return Decimal.of(units, sc).rescale(scale);
		}
		return Decimal.parse(s, scale);
	}

	rescale(scale: number): Decimal {
		if (scale === this.scale) return this;
		if (scale > this.scale)
			return new Decimal(this.units * pow10(scale - this.scale), scale);
		return new Decimal(
			divHalfEven(this.units, pow10(this.scale - scale)),
			scale,
		);
	}

	add(o: Decimal, scale = Math.max(this.scale, o.scale)): Decimal {
		const s = Math.max(this.scale, o.scale);
		return new Decimal(this.rescale(s).units + o.rescale(s).units, s).rescale(
			scale,
		);
	}

	sub(o: Decimal, scale = Math.max(this.scale, o.scale)): Decimal {
		return this.add(o.neg(), scale);
	}

	neg(): Decimal {
		return new Decimal(-this.units, this.scale);
	}

	/** The exact product has scale this.scale + o.scale, then it is rounded once. */
	mul(o: Decimal, scale: number): Decimal {
		return new Decimal(this.units * o.units, this.scale + o.scale).rescale(
			scale,
		);
	}

	/** Rounded half-even at the given scale. Division by zero throws; the engine turns it into Err("div.zero"). */
	div(o: Decimal, scale: number): Decimal {
		if (o.units === 0n) throw new RangeError("div.zero");
		// this / o = (a / 10^as) / (b / 10^bs); we want units at `scale`: a * 10^(scale + bs - as) / b
		const shift = scale + o.scale - this.scale;
		const n = shift >= 0 ? this.units * pow10(shift) : this.units;
		const d = shift >= 0 ? o.units : o.units * pow10(-shift);
		return new Decimal(divHalfEven(n, d), scale);
	}

	cmp(o: Decimal): -1 | 0 | 1 {
		const s = Math.max(this.scale, o.scale);
		const a = this.rescale(s).units,
			b = o.rescale(s).units;
		return a < b ? -1 : a > b ? 1 : 0;
	}

	/** "19.99", "-0.50", "12" (scale 0). Never "-0". */
	toString(): string {
		const neg = this.units < 0n;
		const digits = (neg ? -this.units : this.units)
			.toString()
			.padStart(this.scale + 1, "0");
		const int = digits.slice(0, digits.length - this.scale);
		const frac =
			this.scale > 0 ? "." + digits.slice(digits.length - this.scale) : "";
		return (neg ? "-" : "") + int + frac;
	}

	toJSON(): string {
		return this.toString();
	}
}
