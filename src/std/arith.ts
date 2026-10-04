import { fn, type KitFn, t } from "../kit";
import { Decimal, FnError } from "../values";

/**
 * Arithmetic on two values, as one function with an overload per mix of
 * numbers and decimals. A decimal argument makes the result a decimal with
 * that argument's type and scale; with two, the first one's. Its parameters
 * are nullable, and a `null` argument gives `null`, as an empty cell does in
 * a spreadsheet.
 *
 * @param commutes - whether `a op b` is `b op a`, so a number on the left can
 *   be handed to the decimal's own method
 */
export function arith(
	name: string,
	onNumbers: (a: number, b: number) => number,
	onDecimals: (a: Decimal, b: Decimal | number) => Decimal,
	commutes: boolean,
): KitFn {
	const num = t.number.nullable();
	const dec = t.decimal.nullable();
	return fn(
		name,
		{
			params: [{ a: num }, { b: num }],
			returns: num,
			impl: ({ a, b }) => (a === null || b === null ? null : onNumbers(a, b)),
		},
		{
			params: [{ a: dec }, { b: dec }],
			returns: "a",
			impl: ({ a, b }) => (a === null || b === null ? null : onDecimals(a, b)),
		},
		{
			params: [{ a: dec }, { b: num }],
			returns: "a",
			impl: ({ a, b }) => (a === null || b === null ? null : onDecimals(a, b)),
		},
		{
			params: [{ a: num }, { b: dec }],
			returns: "b",
			impl: ({ a, b }) => {
				if (a === null || b === null) return null;
				return commutes
					? onDecimals(b, a)
					: onDecimals(Decimal.from(a, b.scale), b);
			},
		},
	);
}

/** A quotient, or `div.zero`. */
export function divide(a: number, b: number): number {
	if (b === 0) throw new FnError("div.zero", "division by zero");
	return a / b;
}

/** A decimal quotient, or `div.zero`. */
export function divideDecimal(a: Decimal, b: Decimal | number): Decimal {
	const q = a.div(b);
	if (!q) throw new FnError("div.zero", "division by zero");
	return q;
}
