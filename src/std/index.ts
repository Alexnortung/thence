/**
 * std: the function library a kit spreads into `functions`. It holds
 * inverses, lazy parameters and the descriptors of incremental aggregates;
 * the engine does the folding.
 *
 * So far only what the walking skeleton needs: `add`, `sub`, `mul`, `div`
 * and `sum`, on numbers and decimals.
 *
 * @module
 */

import type { Aggregate, StdFn } from "../kit";
import { Decimal, ExactSum, type Result } from "../values";

/** The std functions, as a value to spread into `kit({ functions })`. */
export interface Std {
	readonly "~std": true;
	readonly add: StdFn;
	readonly sub: StdFn;
	readonly mul: StdFn;
	readonly div: StdFn;
	readonly sum: StdFn;
}

type Num = number | Decimal;

function ok(value: unknown): Result<unknown> {
	return { ok: true, value };
}
function fail(code: string, message: string): Result<never> {
	return { ok: false, error: { code, message, at: [] } };
}
function finite(n: number): Result<unknown> {
	return Number.isFinite(n)
		? ok(n)
		: fail("number.overflow", "the result is too large for a number");
}

/** Arithmetic on two values: `null` if either is `null`, a decimal if either is one. */
function arith(
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

/** Sums numbers, or decimals, exactly and in any order; skips `null`. */
const sumAggregate: Aggregate<
	{ numbers: ExactSum; decimal: Decimal | undefined },
	Num | null,
	Num
> = {
	"~kind": "aggregate",
	init: () => ({ numbers: new ExactSum(), decimal: undefined }),
	add: (acc, v) => {
		if (v === null) return acc;
		if (v instanceof Decimal)
			acc.decimal = acc.decimal ? acc.decimal.add(v) : v;
		else acc.numbers.add(v);
		return acc;
	},
	remove: (acc, v) => {
		if (v === null) return acc;
		if (v instanceof Decimal) acc.decimal = acc.decimal?.sub(v);
		else acc.numbers.remove(v);
		return acc;
	},
	result: (acc) =>
		acc.decimal ? acc.decimal.add(acc.numbers.value()) : acc.numbers.value(),
};

export const std: Std = {
	"~std": true,
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
