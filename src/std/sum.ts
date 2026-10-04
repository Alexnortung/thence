import { type Aggregate, fn, type KitFn, t } from "../kit";
import { Decimal, ExactSum } from "../values";

type Num = number | Decimal;

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

/**
 * `sum`: adds up a list's values, kept up to date one element at a time.
 * Numbers and decimals both use the same exact aggregate; a sum of decimals
 * is a decimal.
 */
export const sum: KitFn = fn(
	"sum",
	{
		params: [{ xs: t.list(t.number) }],
		returns: t.number,
		aggregate: sumAggregate,
	},
	{
		params: [{ xs: t.list(t.decimal) }],
		returns: "xs",
		aggregate: sumAggregate,
	},
);
