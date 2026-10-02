import { shell } from "../shell";
import type { Decimal, Json } from "../values";
import type { AnyTrait } from "./entity";

export interface StandardSchemaV1 {
	readonly "~standard": unknown;
}

/** What `set` and `.initial` accept for a value of type V. */
export type In<V> = V extends Decimal ? Decimal | string | number : V;

export interface ValueType<V = unknown> {
	readonly "~kind": "value";
	readonly "~v": V;
	nullable(): ValueType<V | null>;
	initial(v: In<V>): Initial<V>;
	optional(): Optional<ValueType<V>>;
	check(schema: StandardSchemaV1): ValueType<V>;
}
export interface Initial<V> {
	readonly "~kind": "initial";
	readonly "~v": V;
	check(schema: StandardSchemaV1): Initial<V>;
}
export interface ExprType<V> {
	readonly "~kind": "expr";
	readonly "~v": V;
	optional(): Optional<ExprType<V>>;
}
export interface Optional<X> {
	readonly "~kind": "optional";
	readonly "~of": X;
}
export interface EnumType<V extends string> extends ValueType<V> {
	readonly values: readonly V[];
}
export interface EnumDef {
	readonly "~kind": "enumDef";
}
export interface ListT<X> {
	readonly "~kind": "list";
	readonly "~of": X;
}
export interface MapT<X> {
	readonly "~kind": "map";
	readonly "~of": X;
}
export interface OneOf<Xs extends readonly unknown[]> {
	readonly "~kind": "oneOf";
	readonly "~of": Xs;
}
export interface All<Ts extends readonly AnyTrait[]> {
	readonly "~kind": "all";
	readonly "~of": Ts;
}
export interface Meta<M> {
	readonly "~kind": "meta";
	readonly "~m": M;
}

export type DecimalTypeFactory = (
	name: string,
	opts: { scale: number },
) => ValueType<Decimal>;
export interface NumberType extends ValueType<number> {
	(
		name: string,
		opts?: { converge?: { abs?: number; rel?: number } },
	): ValueType<number>;
}
export interface EnumFactory {
	<const Vs extends readonly string[]>(
		name: string,
		values: Vs,
	): EnumType<Vs[number]>;
	/** config: the Builder lists the values, or names one of your enums */
	def(): EnumDef;
	/** input: one of the values the named config member holds */
	from(member: string): ValueType<string>;
}

export const t: {
	number: NumberType;
	int: ValueType<number>;
	decimal: DecimalTypeFactory;
	text: ValueType<string>;
	bool: ValueType<boolean>;
	date: ValueType<string>;
	json: ValueType<Json>;
	enum: EnumFactory;
	expr<V>(type: ValueType<V>): ExprType<V>;
	list<X>(of: X): ListT<X>;
	map<X>(of: X): MapT<X>;
	oneOf<const Xs extends readonly unknown[]>(...of: Xs): OneOf<Xs>;
	all<const Ts extends readonly AnyTrait[]>(...of: Ts): All<Ts>;
	/** spike addition: the README never says how `meta` is typed */
	meta<M>(): Meta<M>;
} = shell("t");
