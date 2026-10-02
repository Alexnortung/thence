import type { StdFn } from "../kit";
import { Decimal, fail, ok, type Result } from "../values";

type Num = number | Decimal;

export function finite(n: number): Result<unknown> {
	return Number.isFinite(n)
		? ok(n)
		: fail("number.overflow", "the result is too large for a number");
}

/** Arithmetic on two values: `null` if either is `null`, a decimal if either is one. */
export function arith(
	name: string,
	onNumbers: (a: number, b: number) => Result<unknown>,
	onDecimals: (a: Decimal, b: Decimal | number) => Result<unknown>,
	commutes: boolean,
): StdFn {
	return {
		"~kind": "std",
		name,
		arity: 2,
		call: ([a, b]) => {
			if (a === null || b === null) return ok(null);
			if (a instanceof Decimal) return onDecimals(a, b as Num);
			if (b instanceof Decimal) {
				return commutes
					? onDecimals(b, a as number)
					: onDecimals(Decimal.from(a as number, b.scale), b);
			}
			return onNumbers(a as number, b as number);
		},
	};
}
