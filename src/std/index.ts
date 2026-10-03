/**
 * std: the function library a kit spreads into `functions`. It holds
 * inverses, lazy parameters and the descriptors of incremental aggregates;
 * the engine does the folding.
 *
 * Every std function is made with `fn()`, exactly as a Developer's own, so a
 * kit can add, replace or leave out any of them.
 *
 * So far: `add`, `sub`, `mul` and `div` on numbers and decimals, and the
 * aggregates `sum`, `count`, `min`, `max`, `any`, `all` and `sumValid`. Their inverses, which let a write to
 * `price * qty` land on `qty`, come with writable derived values (#16), as
 * an `inverse` per parameter in each signature.
 *
 * @module
 */

import { all, any, count, max, min, sumValid } from "./aggregates";
import { arith, divide, divideDecimal } from "./arith";
import { sum } from "./sum";
import type { Std } from "./types";

export type * from "./types";

export const std: Std = {
	add: arith(
		"add",
		(a, b) => a + b,
		(a, b) => a.add(b),
		true,
	),
	sub: arith(
		"sub",
		(a, b) => a - b,
		(a, b) => a.sub(b),
		false,
	),
	mul: arith(
		"mul",
		(a, b) => a * b,
		(a, b) => a.mul(b),
		true,
	),
	div: arith("div", divide, divideDecimal, false),
	sum,
	sumValid,
	count,
	min,
	max,
	any,
	all,
};
