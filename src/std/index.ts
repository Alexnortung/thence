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
 * So far only what the walking skeleton needs: `add`, `sub`, `mul`, `div`
 * and `sum`, on numbers and decimals. Their inverses, which let a write to
 * `price * qty` land on `qty`, come with writable derived values (#16), as
 * an `inverse` per parameter in each signature.
 *
 * @module
 */

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
};
