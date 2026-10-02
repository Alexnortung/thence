/**
 * An exact running sum of numbers (Shewchuk's partials, as in Python's
 * `math.fsum`). It holds the sum without rounding and rounds once when read,
 * so the result doesn't depend on the order values were added. Removing a
 * value gives exactly the sum of what is left, which lets the engine update
 * a total when one row changes instead of summing every row again.
 */
export class ExactSum {
	/** Non-overlapping doubles whose exact sum is the running total, smallest first. */
	#partials: number[] = [];
	/** The infinity an intermediate sum overflowed to, or 0. */
	#overflow = 0;

	add(value: number): this {
		if (this.#overflow !== 0) return this;
		const p = this.#partials;
		let x = value;
		let i = 0;
		for (let y of p) {
			if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
			const hi = x + y;
			if (!Number.isFinite(hi)) {
				this.#overflow = hi;
				return this;
			}
			const lo = y - (hi - x);
			if (lo !== 0) p[i++] = lo;
			x = hi;
		}
		p.length = i;
		p.push(x);
		return this;
	}

	remove(value: number): this {
		return this.add(-value);
	}

	/**
	 * The exact sum, rounded half-even to a double, and never `-0`. An infinity
	 * when it overflows; the engine reports that as `number.overflow`. Once a
	 * sum has overflowed, removing values doesn't bring it back: sum what is
	 * left in a new `ExactSum`.
	 */
	value(): number {
		if (this.#overflow !== 0) return this.#overflow;
		const p = this.#partials;
		let n = p.length;
		let hi = p[--n] ?? 0;
		let lo = 0;
		while (n > 0) {
			const x = hi;
			const y = p[--n] ?? 0;
			hi = x + y;
			lo = y - (hi - x);
			if (lo !== 0) break;
		}
		// A half-way case: if the partials below push lo past the tie, round away from it.
		const below = p[n - 1] ?? 0;
		if (n > 0 && ((lo < 0 && below < 0) || (lo > 0 && below > 0))) {
			const y = lo * 2;
			const x = hi + y;
			if (y === x - hi) hi = x;
		}
		return hi === 0 ? 0 : hi;
	}
}

/** The exact sum of `values`, rounded once. */
export function fsum(values: Iterable<number>): number {
	const sum = new ExactSum();
	for (const value of values) sum.add(value);
	return sum.value();
}
