import { shell } from "../shell";
import type { Decimal, Json } from "../values";
import type { AnyEntity, AnyTrait, TraitInitial } from "./entity";

/** The part of a Standard Schema that thence needs: any schema library's object passes. */
export interface StandardSchemaV1 {
	readonly "~standard": unknown;
}

/**
 * What `set` and `.initial` accept for a value of type V. A decimal also
 * takes a string or a number, which thence parses at the type's scale.
 *
 * @typeParam V - the value the member holds
 */
export type In<V> = V extends Decimal ? Decimal | string | number : V;

/**
 * A value type such as `t.number` or `t.text`. As an input it has no initial
 * value yet, so it must be made `.nullable()` or given `.initial(v)`.
 *
 * @typeParam V - the TypeScript type of the values it holds
 */
export interface ValueType<V = unknown> {
	readonly "~kind": "value";
	readonly "~v": V;
	nullable(): ValueType<V | null>;
	initial(v: In<V>): Initial<V>;
	optional(): Optional<ValueType<V>>;
	check(schema: StandardSchemaV1): ValueType<V>;
}
/**
 * A value type with the value an input starts from, made by `t.number.initial(0)`.
 *
 * @typeParam V - the TypeScript type of the values it holds
 */
export interface Initial<V> {
	readonly "~kind": "initial";
	readonly "~v": V;
	check(schema: StandardSchemaV1): Initial<V>;
}
/**
 * A formula the Builder writes, made by `t.expr(t.number)`. Only config members
 * have this type; the entity reads the formula's value with `e.self`.
 *
 * @typeParam V - the type the formula must compute
 */
export interface ExprType<V> {
	readonly "~kind": "expr";
	readonly "~v": V;
	optional(): Optional<ExprType<V>>;
}
/**
 * A config member the Builder may leave out, made by `.optional()`. Reading it
 * gives `undefined` unless the expression supplies a fallback.
 *
 * @typeParam X - the member type it wraps
 */
export interface Optional<X> {
	readonly "~kind": "optional";
	readonly "~of": X;
}
/**
 * An enum you know when writing the kit, made by `t.enum("Unit", ["kg", "g"])`.
 *
 * @typeParam V - the union of its values
 */
export interface EnumType<V extends string> extends ValueType<V> {
	readonly values: readonly V[];
}
/** A config member where the Builder lists an enum's values or names one of yours, made by `t.enum.def()`. */
export interface EnumDef {
	readonly "~kind": "enumDef";
}
/**
 * An ordered list, made by `t.list(X)`.
 *
 * @typeParam X - the member type of each element: a value type, an entity, a trait, `t.oneOf` or `t.all`
 */
export interface ListT<X> {
	readonly "~kind": "list";
	readonly "~of": X;
}
/**
 * An ordered map with unique keys, made by `t.map(X)`.
 *
 * @typeParam X - the member type of each value, as for {@link ListT}
 */
export interface MapT<X> {
	readonly "~kind": "map";
	readonly "~of": X;
}
/**
 * Exactly one of the listed entities or traits, made by `t.oneOf(ECharge, ENote)`.
 *
 * @typeParam Xs - the entities and traits it may hold
 */
export interface OneOf<Xs extends readonly unknown[]> {
	readonly "~kind": "oneOf";
	readonly "~of": Xs;
}
/**
 * Any entity that implements every listed trait, made by `t.all(TPriced, TNamed)`.
 *
 * @typeParam Ts - the traits it must implement
 */
export interface All<Ts extends readonly AnyTrait[]> {
	readonly "~kind": "all";
	readonly "~of": Ts;
}
/**
 * The type of every node's `meta`, made by `t.meta<M>()`. thence stores meta but never reads it.
 *
 * @typeParam M - your meta type, such as `{ label: string }`
 */
export interface Meta<M> {
	readonly "~kind": "meta";
	readonly "~m": M;
}

/**
 * Anything a trait or an entity can declare as a member's type: a value type,
 * a formula, an enum definition, a collection, another entity or trait, a
 * trait with its initial entity, or a function returning one of these, for an
 * entity defined further down the file.
 */
export type MemberDef =
	| ValueType<any>
	| Initial<any>
	| ExprType<any>
	| Optional<any>
	| EnumDef
	| ListT<any>
	| MapT<any>
	| OneOf<any>
	| All<any>
	| AnyEntity
	| AnyTrait
	| TraitInitial<any, any>
	| (() => MemberDef);

/** `t.decimal("Money", { scale: 2 })`: a named decimal type with a fixed number of places. */
export type DecimalTypeFactory = (
	name: string,
	opts: { scale: number },
) => ValueType<Decimal>;
/** `t.number`, or `t.number("Temperature", { converge })` for a named number type with its own cycle tolerance. */
export interface NumberType extends ValueType<number> {
	(
		name: string,
		opts?: { converge?: { abs?: number; rel?: number } },
	): ValueType<number>;
}
/** `t.enum`: your own enums, and the Builder's. */
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
