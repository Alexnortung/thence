import type { Aggregate } from "../kit";
import { Decimal, ExactSum } from "../values";

type Num = number | Decimal;

/** Sums numbers, or decimals, exactly and in any order; skips `null`. */
export const sumAggregate: Aggregate<
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
