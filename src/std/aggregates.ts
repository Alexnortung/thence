import { type Aggregate, fn, type KitFn, t } from "../kit";
import { Decimal } from "../values";
import { sumAggregate } from "./sum";

type Num = number | Decimal;

/** `count`: how many values aren't `null`. */
export const count: KitFn = fn("count", {
	params: { xs: t.list(t.json) },
	returns: t.int,
	aggregate: {
		"~kind": "aggregate",
		init: () => 0,
		add: (n: number, v: unknown) => (v === null ? n : n + 1),
		remove: (n: number, v: unknown) => (v === null ? n : n - 1),
		result: (n: number) => n,
	},
});

/**
 * How many times each value occurs, and the extreme one. Removing the
 * extreme value forgets it, and the next result looks for the new one, so a
 * change that doesn't touch the extreme never visits the others.
 */
interface Extremes {
	readonly values: Map<string, { value: Num; n: number }>;
	best: Num | undefined;
}

/** `min` or `max` over numbers or decimals, skipping `null`. */
function extreme(name: "min" | "max"): KitFn {
	const sign = name === "min" ? -1 : 1;
	const better = (a: Num, b: Num) => compare(a, b) * sign > 0;
	const aggregate: Aggregate<Extremes, Num | null, Num | null> = {
		"~kind": "aggregate",
		init: () => ({ values: new Map(), best: undefined }),
		add: (acc, v) => {
			if (v === null) return acc;
			const k = String(v);
			const entry = acc.values.get(k);
			if (entry) entry.n++;
			else acc.values.set(k, { value: v, n: 1 });
			if (acc.best !== undefined && better(v, acc.best)) acc.best = v;
			if (acc.values.size === 1) acc.best = v;
			return acc;
		},
		remove: (acc, v) => {
			if (v === null) return acc;
			const k = String(v);
			const entry = acc.values.get(k);
			if (!entry) return acc;
			if (--entry.n === 0) {
				acc.values.delete(k);
				if (acc.best !== undefined && String(acc.best) === k)
					acc.best = undefined;
			}
			return acc;
		},
		result: (acc) => {
			if (acc.best === undefined) {
				for (const { value } of acc.values.values()) {
					if (acc.best === undefined || better(value, acc.best))
						acc.best = value;
				}
			}
			return acc.best ?? null;
		},
	};
	return fn(
		name,
		{ params: { xs: t.list(t.number) }, returns: t.number, aggregate },
		{ params: { xs: t.list(t.decimal) }, returns: "xs", aggregate },
	);
}

/** `min`: the smallest value, or `null` when there is none. */
export const min: KitFn = extreme("min");
/** `max`: the largest value, or `null` when there is none. */
export const max: KitFn = extreme("max");

/** How many values are true and false, for `any` and `all`. */
interface Truths {
	yes: number;
	no: number;
}
const truths = (result: (acc: Truths) => boolean): Aggregate => ({
	"~kind": "aggregate",
	init: (): Truths => ({ yes: 0, no: 0 }),
	add: (acc: Truths, v: boolean | null) => {
		if (v === true) acc.yes++;
		else if (v === false) acc.no++;
		return acc;
	},
	remove: (acc: Truths, v: boolean | null) => {
		if (v === true) acc.yes--;
		else if (v === false) acc.no--;
		return acc;
	},
	result,
});

/** `any`: whether at least one value is true. */
export const any: KitFn = fn("any", {
	params: { xs: t.list(t.bool) },
	returns: t.bool,
	aggregate: truths((acc) => acc.yes > 0),
});
/** `all`: whether no value is false; true for none. */
export const all: KitFn = fn("all", {
	params: { xs: t.list(t.bool) },
	returns: t.bool,
	aggregate: truths((acc) => acc.no === 0),
});

/** `sumValid`: like `sum`, but leaves out the values that are errors instead of failing. */
const sumValidAggregate: Aggregate = { ...sumAggregate, skipErrors: true };
export const sumValid: KitFn = fn(
	"sumValid",
	{
		params: { xs: t.list(t.number) },
		returns: t.number,
		aggregate: sumValidAggregate,
	},
	{
		params: { xs: t.list(t.decimal) },
		returns: "xs",
		aggregate: sumValidAggregate,
	},
);

/** Compares a number or a decimal with another; a number is read at the decimal's scale. */
function compare(a: Num, b: Num): number {
	if (a instanceof Decimal || b instanceof Decimal) {
		const x = a instanceof Decimal ? a : Decimal.from(a, (b as Decimal).scale);
		const y = b instanceof Decimal ? b : Decimal.from(b, x.scale);
		return x.compare(y);
	}
	return a < b ? -1 : a > b ? 1 : 0;
}
