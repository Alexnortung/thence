import { fn, type KitFn, t } from "../kit";
import { Decimal, FnError } from "../values";

/**
 * Arithmetic on two values, as one function with an overload per mix of
 * numbers and decimals. A decimal argument makes the result a decimal with
 * that argument's type and scale; with two, the first one's. A `null`
 * argument makes the result `null` (`forwardNull`).
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
	return fn(
		name,
		{
			params: [{ a: t.number }, { b: t.number }],
			returns: t.number,
			forwardNull: true,
			impl: ({ a, b }: { a: number; b: number }) => onNumbers(a, b),
		},
		{
			params: [{ a: t.decimal }, { b: t.decimal }],
			returns: "a",
			forwardNull: true,
			impl: ({ a, b }: { a: Decimal; b: Decimal }) => onDecimals(a, b),
		},
		{
			params: [{ a: t.decimal }, { b: t.number }],
			returns: "a",
			forwardNull: true,
			impl: ({ a, b }: { a: Decimal; b: number }) => onDecimals(a, b),
		},
		{
			params: [{ a: t.number }, { b: t.decimal }],
			returns: "b",
			forwardNull: true,
			impl: ({ a, b }: { a: number; b: Decimal }) =>
				commutes ? onDecimals(b, a) : onDecimals(Decimal.from(a, b.scale), b),
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
