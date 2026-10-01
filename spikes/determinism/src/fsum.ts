// The exact sum of doubles, rounded once (Shewchuk's partials, as in Python's math.fsum).
// The accumulator holds the exact sum of everything added, so the result never depends on order,
// and removing a value is adding its negation. That is what lets an incremental `sum` stay bit-identical.

export class ExactSum {
	private partials: number[] = [];

	add(value: number): this {
		let x = value;
		let i = 0;
		const p = this.partials;
		for (let j = 0; j < p.length; j++) {
			let y = p[j]!;
			if (Math.abs(x) < Math.abs(y)) {
				const t = x;
				x = y;
				y = t;
			}
			const hi = x + y;
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

	/** The exact sum, rounded half-even to a double. */
	value(): number {
		const p = this.partials;
		let n = p.length;
		if (n === 0) return 0;
		let hi = p[--n]!;
		let lo = 0;
		while (n > 0) {
			const x = hi;
			const y = p[--n]!;
			hi = x + y;
			const yr = hi - x;
			lo = y - yr;
			if (lo !== 0) break;
		}
		// Correct a half-way case: if the rest of the partials push lo past the tie, round away from it.
		if (n > 0 && ((lo < 0 && p[n - 1]! < 0) || (lo > 0 && p[n - 1]! > 0))) {
			const y = lo * 2;
			const x = hi + y;
			const yr = x - hi;
			if (y === yr) hi = x;
		}
		return hi === 0 ? 0 : hi; // never -0
	}
}

export function fsum(values: Iterable<number>): number {
	const s = new ExactSum();
	for (const v of values) s.add(v);
	return s.value();
}
