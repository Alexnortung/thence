import { fn, type KitFn, t } from "../kit";
import { Decimal, FnError } from "../values";

/**
 * How to get one argument back from the result and the other argument, in
 * terms of the four operations. `add`'s `a` is `result - b`.
 */
export interface Inverse {
	a<T>(ops: Ops<T>, result: T, b: T): T;
	b<T>(ops: Ops<T>, result: T, a: T): T;
}

/** The arithmetic an inverse is written in, on numbers or on decimals. */
interface Ops<T> {
	add(a: T, b: T): T;
	sub(a: T, b: T): T;
	mul(a: T, b: T): T;
	/** Throws `write.noAnswer` when `b` is zero. */
	div(a: T, b: T): T;
}

/**
 * Arithmetic on two values, as one function with an overload per mix of
 * numbers and decimals. A decimal argument makes the result a decimal with
 * that argument's type and scale; with two, the first one's. Its parameters
 * are nullable, and a `null` argument gives `null`, as an empty cell does in
 * a spreadsheet.
 *
 * @param commutes - whether `a op b` is `b op a`, so a number on the left can
 *   be handed to the decimal's own method
 * @param inverse - how a write to the result goes back to `a` or `b`
 */
export function arith(
	name: string,
	onNumbers: (a: number, b: number) => number,
	onDecimals: (a: Decimal, b: Decimal | number) => Decimal,
	commutes: boolean,
	inverse: Inverse,
): KitFn {
	const num = t.number.nullable();
	const dec = t.decimal.nullable();
	return fn(
		name,
		{
			params: [{ a: num }, { b: num }],
			returns: num,
			impl: ({ a, b }) => (a === null || b === null ? null : onNumbers(a, b)),
			inverse: inverses(name, inverse, "number", "number"),
		},
		{
			params: [{ a: dec }, { b: dec }],
			returns: "a",
			impl: ({ a, b }) => (a === null || b === null ? null : onDecimals(a, b)),
			inverse: inverses(name, inverse, "decimal", "decimal"),
		},
		{
			params: [{ a: dec }, { b: num }],
			returns: "a",
			impl: ({ a, b }) => (a === null || b === null ? null : onDecimals(a, b)),
			inverse: inverses(name, inverse, "decimal", "number"),
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
			inverse: inverses(name, inverse, "number", "decimal"),
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

type Kind = "number" | "decimal";
type Num = number | Decimal;

/**
 * One signature's `inverse`: on decimals when the result or the other
 * argument is one, and given back as the parameter's kind. There is no
 * answer while the other argument is empty, since the result is then empty
 * whatever the input.
 */
function inverses(
	name: string,
	inverse: Inverse,
	a: Kind,
	b: Kind,
): Record<
	"a" | "b",
	(args: { result: Num; a: Num | null; b: Num | null }) => Num
> {
	const solve = (
		kind: Kind,
		result: Num,
		other: Num | null,
		f: <T>(ops: Ops<T>, result: T, other: T) => T,
	): Num => {
		if (other === null) {
			throw new FnError(
				"write.noAnswer",
				`"${name}" has no answer while an argument is empty`,
			);
		}
		const value =
			result instanceof Decimal || other instanceof Decimal
				? f(decimals, wide(result), wide(other))
				: f(numbers, result, other);
		return kind === "decimal" ? wide(value) : Number(value);
	};
	return {
		a: ({ result, b: other }) => solve(a, result, other, inverse.a),
		b: ({ result, a: other }) => solve(b, result, other, inverse.b),
	};
}

/**
 * The scale an inverse computes at, so that working back through several
 * calls loses nothing the input's own scale would keep. The input's type
 * rounds the answer once, when it is written.
 */
const WIDE = 18;

function wide(x: Num): Decimal {
	if (!(x instanceof Decimal)) return Decimal.from(x, WIDE);
	return x.scale >= WIDE ? x : x.rescale(WIDE);
}

function noAnswer(): never {
	throw new FnError(
		"write.noAnswer",
		"no value of the input gives this result, or every value does",
	);
}

const numbers: Ops<number> = {
	add: (a, b) => a + b,
	sub: (a, b) => a - b,
	mul: (a, b) => a * b,
	div: (a, b) => (b === 0 ? noAnswer() : a / b),
};
const decimals: Ops<Decimal> = {
	add: (a, b) => a.add(b),
	sub: (a, b) => a.sub(b),
	mul: (a, b) => a.mul(b),
	div: (a, b) => a.div(b) ?? noAnswer(),
};
