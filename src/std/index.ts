/**
 * std: the function library every kit has unless its `stdFunctions` says
 * otherwise. It holds
 * inverses, lazy parameters and the descriptors of incremental aggregates;
 * the engine does the folding.
 *
 * Every std function is made with `fn()`, exactly as a Developer's own, so a
 * kit can replace one through `functions`, or choose which it offers
 * through `stdFunctions`.
 *
 * So far: `add`, `sub`, `mul` and `div` on numbers and decimals, and the
 * aggregates `sum`, `count`, `min`, `max`, `any`, `all` and `sumValid`. The
 * arithmetic has an `inverse` for each parameter in each signature, which
 * lets a write to `price * 2` land on `price`; the aggregates have none.
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
		{ a: (o, r, b) => o.sub(r, b), b: (o, r, a) => o.sub(r, a) },
	),
	sub: arith(
		"sub",
		(a, b) => a - b,
		(a, b) => a.sub(b),
		false,
		{ a: (o, r, b) => o.add(r, b), b: (o, r, a) => o.sub(a, r) },
	),
	mul: arith(
		"mul",
		(a, b) => a * b,
		(a, b) => a.mul(b),
		true,
		{ a: (o, r, b) => o.div(r, b), b: (o, r, a) => o.div(r, a) },
	),
	div: arith("div", divide, divideDecimal, false, {
		a: (o, r, b) => o.mul(r, b),
		b: (o, r, a) => o.div(a, r),
	}),
	sum,
	sumValid,
	count,
	min,
	max,
	any,
	all,
};
