/**
 * std: the function library a kit spreads into `functions`. It holds
 * inverses, lazy parameters and the descriptors of incremental aggregates;
 * the engine does the folding.
 *
 * So far only what the walking skeleton needs: `add`, `sub`, `mul`, `div`
 * and `sum`, on numbers and decimals. Their inverses, which let a write to
 * `price * qty` land on `qty`, come with writable derived values (#16), as
 * an `inverse` per argument on `StdFn`.
 *
 * @module
 */

import { fail, ok } from "../values";
import { arith, finite } from "./arith";
import { sumAggregate } from "./sum";
import type { Std } from "./types";

export type * from "./types";

export const std: Std = {
	add: arith(
		"add",
		(a, b) => finite(a + b),
		(a, b) => ok(a.add(b)),
		true,
	),
	sub: arith(
		"sub",
		(a, b) => finite(a - b),
		(a, b) => ok(a.sub(b)),
		false,
	),
	mul: arith(
		"mul",
		(a, b) => finite(a * b),
		(a, b) => ok(a.mul(b)),
		true,
	),
	div: arith(
		"div",
		(a, b) => (b === 0 ? fail("div.zero", "division by zero") : finite(a / b)),
		(a, b) => {
			const q = a.div(b);
			return q ? ok(q) : fail("div.zero", "division by zero");
		},
		false,
	),
	sum: { "~kind": "std", name: "sum", arity: 1, aggregate: sumAggregate },
};
