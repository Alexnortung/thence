// Types-only spike: the public types the README promises, with no engine behind them.
// Nothing here is the real implementation. The point is to learn which promises TypeScript can keep.

// ============================================================================
// values
// ============================================================================

export declare class Decimal {
	private readonly "~decimal": true;
	toString(): string;
	gte(other: Decimal): boolean;
}

export type Json =
	| null
	| boolean
	| number
	| string
	| readonly Json[]
	| { readonly [k: string]: Json };
export type Path = readonly (string | number)[];
export type ThenceError = {
	code: string;
	at: Path;
	message: string;
	cause?: ThenceError;
};
export type Result<T> =
	| { ok: true; value: T }
	| { ok: false; error: ThenceError };
export type Issue = { message: string; path: Path };
export interface StandardSchemaV1 {
	readonly "~standard": unknown;
}

/** What `set` and `.initial` accept for a value of type V. */
export type In<V> = V extends Decimal ? Decimal | string | number : V;

// ============================================================================
// types (t.*)
// ============================================================================

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

type DecimalTypeFactory = (
	name: string,
	opts: { scale: number },
) => ValueType<Decimal>;
interface NumberType extends ValueType<number> {
	(
		name: string,
		opts?: { converge?: { abs?: number; rel?: number } },
	): ValueType<number>;
}
interface EnumFactory {
	<const Vs extends readonly string[]>(
		name: string,
		values: Vs,
	): EnumType<Vs[number]>;
	/** config: the Builder lists the values, or names one of your enums */
	def(): EnumDef;
	/** input: one of the values the named config member holds */
	from(member: string): ValueType<string>;
}

export declare const t: {
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
};

// ============================================================================
// expressions
// ============================================================================

/** A Builder's expression: JSON with a name first. */
export type BuilderExpr = readonly [string, ...ExprArg[]];
type ExprArg =
	| BuilderExpr
	| number
	| boolean
	| null
	| string
	| { readonly [k: string]: ExprArg };

/** An expression built with e.*: JSON at run time, a typed syntax tree for TypeScript. */
export interface Ex<N = unknown> {
	readonly "~ex": N;
}
/** Either kind of expression, as the README's `Expr` import. */
export type Expr = BuilderExpr | Ex<any>;

// syntax tree nodes (type level only)
interface SelfN<K extends string, F> {
	self: K;
	fb: F;
}
interface LitN<V> {
	lit: V;
}
interface KnownN<V> {
	known: V;
}
/** a parameter inside an expression-bodied fn() */
interface ParamN<K extends string, V> {
	param: K;
	v: V;
}
interface CallN<S extends Sig, A extends readonly unknown[]> {
	sig: S;
	args: A;
}
interface Sig {
	ret: unknown;
	inv: readonly boolean[];
}
/** result kinds the std arithmetic and aggregates compute from their arguments */
interface Arith {
	"~arith": true;
}
interface Elem {
	"~elem": true;
}
interface IfRet {
	"~if": true;
}

type NodeIn<X> =
	X extends Ex<infer N>
		? N
		: X extends number
			? LitN<number>
			: X extends boolean
				? LitN<boolean>
				: X extends string
					? LitN<string>
					: X extends null
						? LitN<null>
						: KnownN<unknown>;
type Nodes<Xs extends readonly unknown[]> = { [I in keyof Xs]: NodeIn<Xs[I]> };
type Arg = Ex<any> | BuilderExpr | number | boolean | string | null;

type Call<
	Ret,
	Inv extends readonly boolean[],
	Xs extends readonly unknown[],
> = Ex<CallN<{ ret: Ret; inv: Inv }, Nodes<Xs>>>;

// ============================================================================
// functions
// ============================================================================

type ParamsOf<P extends Record<string, ValueType<any>>> = {
	[K in keyof P]: P[K]["~v"];
};
export interface Fn<
	N extends string,
	P extends Record<string, ValueType<any>>,
	R,
	Inv extends readonly boolean[],
> {
	readonly "~kind": "fn";
	readonly name: N;
	readonly "~params": P;
	readonly "~ret": R;
	readonly "~inv": Inv;
}
type InvFlags<P, I> = { [K in keyof P]: K extends keyof I ? true : false };
// Object key order isn't a tuple, so the spike can only map inverses for one-parameter functions exactly.
type InvTuple<P extends Record<string, unknown>, I> = keyof P extends infer K
	? K extends keyof I
		? [true]
		: [false]
	: never;

export declare function fn<
	const N extends string,
	P extends Record<string, ValueType<any>>,
	R,
	I extends { [K in keyof P]?: unknown } = {},
>(
	name: N,
	spec: {
		params: P;
		returns: ValueType<R>;
		impl: (args: ParamsOf<P>) => In<R>;
		body?: never;
		inverse?: I & {
			[K in keyof P]?: (args: { result: R } & ParamsOf<P>) => In<P[K]["~v"]>;
		};
	},
): Fn<N, P, R, InvTuple<P, I>>;

/** The body's parameters, one expression each, as `e.fn((row) => …)` gets its row. */
type BodyParams<P extends Record<string, ValueType<any>>> = {
	[K in keyof P]: Ex<ParamN<K & string, P[K]["~v"]>>;
};
/** Whether the body is writable through parameter K, with the other parameters fixed. */
type ParamWritable<N, K> =
	N extends ParamN<infer K2, any>
		? [K2] extends [K]
			? true
			: false
		: N extends CallN<infer S, infer A>
			? OneWritable<{ [I in keyof A]: ParamWritable<A[I], K> }, S["inv"]>
			: false;
// Same limit as InvTuple: exact for one-parameter functions.
type DerivedInvTuple<
	P extends Record<string, unknown>,
	N,
> = keyof P extends infer K
	? K extends keyof P
		? [ParamWritable<N, K>]
		: never
	: never;

/** An expression-bodied function: no `impl`, no `inverse`; each parameter's inverse is derived from the body. */
export declare function fn<
	const N extends string,
	P extends Record<string, ValueType<any>>,
	R,
	B extends Ex<any>,
>(
	name: N,
	spec: {
		params: P;
		returns: ValueType<R>;
		body: (
			params: BodyParams<P>,
		) => B &
			(Eval<NodeIn<B>, never> extends In<R>
				? unknown
				: { "~error": "the body's type doesn't match returns" });
		impl?: never;
		inverse?: never;
	},
): Fn<N, P, R, DerivedInvTuple<P, NodeIn<B>>>;

export declare namespace fn {
	function aggregate<A, V, R>(spec: {
		init: A;
		add(acc: A, v: V): A;
		remove(acc: A, v: V): A;
		result(acc: A): R;
	}): unknown;
}

/** the std functions, as a value to spread into kit({ functions }) */
export declare const std: { readonly "~std": true };

// ============================================================================
// traits, impls, entities
// ============================================================================

export interface Trait<
	N extends string = string,
	M extends Record<string, unknown> = any,
	D extends PropertyKey = any,
> {
	readonly "~kind": "trait";
	readonly name: N;
	readonly "~members": M;
	readonly "~defaults": D;
	/** a trait-typed input: the Operator may switch to any entity that implements the trait */
	initial<E extends AnyEntity>(entity: E): TraitInitial<Trait<N, M, D>, E>;
}
export type AnyTrait = Trait<string, any, any>;
export interface TraitInitial<T extends AnyTrait, E extends AnyEntity> {
	readonly "~kind": "traitInitial";
	readonly "~trait": T;
	readonly "~entity": E;
}

export declare function trait<
	const N extends string,
	const M extends Record<string, unknown>,
	D extends { [K in keyof M]?: Expr } = {},
>(name: N, members: M, defaults?: D): Trait<N, M, keyof D>;

type ImplBody<T extends AnyTrait> = {
	[K in Exclude<keyof T["~members"], T["~defaults"]>]: Expr;
} & { [K in T["~defaults"] & keyof T["~members"]]?: Expr };
export interface Impl<T extends AnyTrait> {
	readonly "~kind": "impl";
	readonly "~trait": T;
}
export declare function impl<T extends AnyTrait>(
	trait: T,
	body: ImplBody<T>,
): Impl<T>;

export interface EntityDef {
	config?: Record<string, unknown>;
	inputs?: Record<string, unknown>;
	derived?: Record<string, Ex<any>>;
	impls?: readonly Impl<any>[];
	seeds?: Record<string, unknown>;
}
export interface Entity<N extends string = string, D extends EntityDef = any> {
	readonly "~kind": "entity";
	readonly name: N;
	readonly "~def": D;
}
export type AnyEntity = Entity<string, any>;

/** An input must start somewhere: an initial value, a nullable type, a collection or a trait's initial entity. */
type CheckInput<X> =
	X extends Initial<any>
		? X
		: X extends ValueType<infer V>
			? null extends V
				? X
				: { error: "an input needs .initial(v) or a .nullable() type" }
			: X;

export declare function entity<
	const N extends string,
	const C extends Record<string, unknown> = {},
	const I extends Record<string, unknown> = {},
	const Dv extends Record<string, Ex<any>> = {},
	const Im extends readonly Impl<any>[] = [],
>(
	name: N,
	def: {
		config?: C;
		inputs?: { [K in keyof I]: CheckInput<I[K]> };
		derived?: Dv;
		impls?: Im;
		seeds?: Record<string, unknown>;
	},
): Entity<N, { config: C; inputs: I; derived: Dv; impls: Im }>;

// ============================================================================
// e.*: expression builders
// ============================================================================

type TraitMemberValue<T, M> = T extends AnyTrait
	? M extends keyof T["~members"]
		? ValueOfType<T["~members"][M]>
		: unknown
	: unknown;
type TraitArg = AnyTrait | string;

export declare const e: {
	self<const K extends string, F = never>(
		member: K,
		fallback?: F,
	): Ex<SelfN<K, F>>;
	as<T extends TraitArg, const M extends string>(
		trait: T,
		member: M,
		fallback?: unknown,
	): Ex<KnownN<TraitMemberValue<T, M>>>;
	up<T extends TraitArg, const M extends string, F>(
		trait: T,
		member: M,
		fallback: F,
	): Ex<KnownN<TraitMemberValue<T, M> | F>>;
	each<T extends AnyTrait, const M extends string>(
		member: string,
		trait: T,
		m: M,
	): Ex<KnownN<readonly TraitMemberValue<T, M>[]>>;
	keyed<T extends AnyTrait, const M extends string>(
		member: string,
		trait: T,
		m: M,
	): Ex<KnownN<Json>>;
	key(): Ex<KnownN<string>>;
	index(): Ex<KnownN<number>>;
	text(s: string): Ex<LitN<string>>;

	add<A extends Arg, B extends Arg>(
		a: A,
		b: B,
	): Call<Arith, [true, true], [A, B]>;
	sub<A extends Arg, B extends Arg>(
		a: A,
		b: B,
	): Call<Arith, [true, true], [A, B]>;
	mul<A extends Arg, B extends Arg>(
		a: A,
		b: B,
	): Call<Arith, [true, true], [A, B]>;
	div<A extends Arg, B extends Arg>(
		a: A,
		b: B,
	): Call<Arith, [true, true], [A, B]>;
	sum<A extends Arg>(list: A): Call<Elem, [false], [A]>;
	if<C extends Arg, A extends Arg, B extends Arg>(
		cond: C,
		then: A,
		otherwise: B,
	): Call<IfRet, [false, false, false], [C, A, B]>;
	and(...xs: Arg[]): Ex<KnownN<boolean>>;
	or(...xs: Arg[]): Ex<KnownN<boolean>>;
	eq(a: Arg, b: Arg): Ex<KnownN<boolean>>;
	gt(a: Arg, b: Arg): Ex<KnownN<boolean>>;
	isNull(a: Arg): Ex<KnownN<boolean>>;
	contains(list: Arg, x: Arg): Ex<KnownN<boolean>>;
	concat(...xs: Arg[]): Ex<KnownN<string>>;
	record(fields: Record<string, Arg>): Ex<KnownN<Json>>;
	entry(key: Arg, x: Arg): Ex<KnownN<Json>>;
	merge(...xs: Arg[]): Ex<KnownN<Json>>;

	call<F extends Fn<string, any, any, any>, const Xs extends readonly Arg[]>(
		f: F,
		...args: Xs
	): Call<F["~ret"], F["~inv"], Xs>;
	entity<E extends AnyEntity>(
		entity: E,
		inputs: { [K in keyof E["~def"]["inputs"]]: Arg },
	): Ex<KnownN<DerivedEntity<E>>>;
	fn<R extends Arg>(
		body: (param: (member: string) => Ex<KnownN<unknown>>) => R,
	): Ex<KnownN<(x: unknown) => unknown>>;
	map<R>(
		list: Arg,
		f: Ex<KnownN<(x: unknown) => R>>,
	): Ex<KnownN<readonly unknown[]>>;
	filter(list: Arg, f: Arg): Ex<KnownN<readonly unknown[]>>;
};

interface DerivedEntity<E extends AnyEntity> {
	readonly "~derivedEntity": E;
}

// ============================================================================
// type-level evaluation: value types and writability of an entity's members
// ============================================================================

type Def<E> = E extends Entity<any, infer D> ? D : never;
type Cfg<D> = D extends { config: infer C } ? C : {};
type Inp<D> = D extends { inputs: infer I } ? I : {};
type Der<D> = D extends { derived: infer V } ? V : {};

/** The value a member type holds, for value members. */
type ValueOfType<X> =
	X extends Initial<infer V>
		? V
		: X extends ValueType<infer V>
			? V
			: X extends ExprType<infer V>
				? V
				: X extends Optional<infer Y>
					? ValueOfType<Y> | undefined
					: unknown;

type IsNumLit<V> = [V] extends [number] ? true : false;
type ArithResult<A, B> = [A] extends [Decimal]
	? Decimal
	: [B] extends [Decimal]
		? Decimal
		: A extends number
			? number
			: unknown;
type ElemOf<L> = L extends readonly (infer X)[] ? X : unknown;

type Eval<N, D> =
	N extends SelfN<infer K, infer F>
		? SelfValue<D, K, F>
		: N extends LitN<infer V>
			? V
			: N extends ParamN<any, infer V>
				? V
				: N extends KnownN<infer V>
					? V
					: N extends CallN<infer S, infer A>
						? CallValue<S["ret"], A, D>
						: unknown;

type SelfValue<D, K extends string, F> = [F] extends [never]
	? MemberValue<D, K>
	: Exclude<MemberValue<D, K>, undefined>;

type CallValue<R, A extends readonly unknown[], D> = R extends Arith
	? ArithResult<Eval<A[0], D>, Eval<A[1], D>>
	: R extends Elem
		? ElemOf<Eval<A[0], D>>
		: R extends IfRet
			? IsNumLit<Eval<A[1], D>> extends true
				? Eval<A[2], D>
				: Eval<A[1], D>
			: R;

type MemberValue<D, K extends string> = K extends keyof Inp<D>
	? ValueOfType<Inp<D>[K]>
	: K extends keyof Der<D>
		? Eval<NodeIn<Der<D>[K]>, D>
		: K extends keyof Cfg<D>
			? ValueOfType<Cfg<D>[K]>
			: unknown;

/** A derived value is writable when every call down to an input has exactly one writable argument with an inverse. */
type Writable<N, D> =
	N extends SelfN<infer K, any>
		? K extends keyof Inp<D>
			? IsValueInput<Inp<D>[K]>
			: K extends keyof Der<D>
				? Writable<NodeIn<Der<D>[K]>, D>
				: false
		: N extends CallN<infer S, infer A>
			? OneWritable<WritableArgs<A, D>, S["inv"]>
			: false;
type IsValueInput<X> = X extends Initial<any> | ValueType<any> ? true : false;
type WritableArgs<A extends readonly unknown[], D> = {
	[I in keyof A]: Writable<A[I], D>;
};
type OneWritable<
	Ws extends readonly unknown[],
	Inv extends readonly boolean[],
> =
	CountTrue<Ws> extends 1
		? TrueAtInverse<Ws, Inv> extends true
			? true
			: false
		: false;
type CountTrue<
	Ws extends readonly unknown[],
	Acc extends unknown[] = [],
> = Ws extends readonly [infer H, ...infer Rest]
	? CountTrue<Rest, H extends true ? [...Acc, 1] : Acc>
	: Acc["length"];
type TrueAtInverse<
	Ws extends readonly unknown[],
	Inv extends readonly boolean[],
> = Ws extends readonly [infer H, ...infer Rest]
	? H extends true
		? Inv extends readonly [infer I, ...any[]]
			? I
			: false
		: TrueAtInverse<
				Rest,
				Inv extends readonly [any, ...infer IR extends boolean[]] ? IR : []
			>
	: false;

type MemberIsWritable<D, K extends string> = K extends keyof Inp<D>
	? IsValueInput<Inp<D>[K]>
	: K extends keyof Der<D>
		? Writable<NodeIn<Der<D>[K]>, D>
		: false;

// ============================================================================
// kits, programs, sessions
// ============================================================================

export interface KitSpec {
	name: string;
	version: string;
	types?: Record<string, unknown>;
	functions?: Record<string, unknown>;
	root: AnyEntity;
	entities: readonly AnyEntity[];
	meta?: Meta<any>;
}
export interface Kit<S extends KitSpec = KitSpec> {
	readonly "~spec": S;
	readonly name: S["name"];
	program(tree: ProgramTree<Kit<S>>): Program<Kit<S>>;
	program(build: (p: ProgramBuilder<Kit<S>>) => void): Program<Kit<S>>;
	check(tree: unknown): Diagnostic[];
}
export type AnyKit = Kit<any>;
export declare function kit<const S extends KitSpec>(spec: S): Kit<S>;

/** Register your kit once so `Handle<typeof EItem>` can type trait-typed members without naming the kit. */
// biome-ignore lint/suspicious/noEmptyInterface: apps add their kit to it by declaration merging
export interface Register {}
type RegisteredKit = Register extends { kit: infer K extends AnyKit }
	? K
	: AnyKit;

type MetaOf<K extends AnyKit> = K["~spec"] extends { meta: Meta<infer M> }
	? M
	: unknown;
export type EntityOf<K extends AnyKit> = K["~spec"]["entities"][number];
type RootOf<K extends AnyKit> = K["~spec"]["root"];

type ImplNames<E> =
	Def<E> extends { impls: infer Im extends readonly unknown[] }
		? Im[number] extends infer I
			? I extends Impl<infer T>
				? T["name"]
				: never
			: never
		: never;
type Implementers<T extends AnyTrait, K extends AnyKit> =
	EntityOf<K> extends infer E
		? E extends AnyEntity
			? T["name"] extends ImplNames<E>
				? E
				: never
			: never
		: never;
type AllOf<
	Ts extends readonly AnyTrait[],
	K extends AnyKit,
> = Ts extends readonly [
	infer H extends AnyTrait,
	...infer R extends readonly AnyTrait[],
]
	? Extract<Implementers<H, K>, AllOf<R, K>>
	: EntityOf<K>;

/** The entities a member type may hold. */
type Expand<X, K extends AnyKit> = X extends () => infer Y
	? Expand<Y, K>
	: X extends AnyEntity
		? X
		: X extends AnyTrait
			? Implementers<X, K>
			: X extends TraitInitial<infer T, any>
				? Implementers<T, K>
				: X extends OneOf<infer Xs>
					? Expand<Xs[number], K>
					: X extends All<infer Ts>
						? AllOf<Ts, K>
						: X extends DerivedEntity<infer E>
							? E
							: never;

// ---------- the Builder's side: NodeOf ----------

export type ParamRef = readonly ["param", string];
type ConfigIn<X, K extends AnyKit> = X extends () => infer Y
	? ConfigIn<Y, K>
	: X extends ExprType<infer V>
		? BuilderExpr | ParamRef | JsonOf<V>
		: X extends EnumDef
			? { enum: readonly { value: string; meta?: MetaOf<K> }[] } | string
			: X extends ValueType<infer V>
				? JsonOf<V> | ParamRef
				: X extends MapT<infer Y>
					? {
							readonly [key: string]:
								| NodeFor<Expand<Y, K>, K>
								| ComponentNode<K>;
						}
					: X extends ListT<infer Y>
						? readonly (NodeFor<Expand<Y, K>, K> | ComponentNode<K>)[]
						: X extends AnyEntity | AnyTrait | OneOf<any> | All<any>
							? NodeFor<Expand<X, K>, K> | ComponentNode<K>
							: never;
type JsonOf<V> = V extends Decimal ? string | number : V;

type OptionalKeys<C> = {
	[M in keyof C]: C[M] extends Optional<any> ? M : never;
}[keyof C];
type RequiredKeys<C> = Exclude<keyof C, OptionalKeys<C>>;
type ConfigNode<C, K extends AnyKit> = {
	[M in RequiredKeys<C>]: ConfigIn<C[M], K>;
} & {
	[M in OptionalKeys<C>]?: C[M] extends Optional<infer Y>
		? ConfigIn<Y, K>
		: never;
};
type ConfigPart<E, K extends AnyKit> = [RequiredKeys<Cfg<Def<E>>>] extends [
	never,
]
	? { config?: ConfigNode<Cfg<Def<E>>, K> }
	: { config: ConfigNode<Cfg<Def<E>>, K> };

type InputIn<X, K extends AnyKit> =
	X extends ListT<infer Y>
		?
				| {
						template?: Template<Expand<Y, K>, K>;
						initial?: readonly InitialRow<Expand<Y, K>, K>[];
				  }
				| readonly InitialRow<Expand<Y, K>, K>[]
		: X extends MapT<infer Y>
			? {
					template?: Template<Expand<Y, K>, K>;
					initial?: { readonly [key: string]: Overlay<Expand<Y, K>, K> };
				}
			: X extends Initial<infer V> | ValueType<infer V>
				? JsonOf<V>
				: X extends TraitInitial<any, any>
					? { type: string }
					: never;
type Template<E, K extends AnyKit> = E extends AnyEntity
	? Omit<ConfigPart<E, K>, never> & { inputs?: InputOverrides<E, K> }
	: never;
/** A starting row: an id for paths, laid over the template key by key. */
type InitialRow<E, K extends AnyKit> = Overlay<E, K> & { id?: string };
/**
 * The overlay rule: like a node, but without `type`, and every part optional.
 * TypeScript can't see which fields the template has, so "no field the template lacks"
 * and "no change of type" are the checker's diagnostics, not compile errors.
 */
type Overlay<E, K extends AnyKit> = E extends AnyEntity
	? {
			meta?: MetaOf<K>;
			config?: { [M in keyof Cfg<Def<E>>]?: OverlayIn<Cfg<Def<E>>[M], K> };
			inputs?: InputOverrides<E, K>;
		}
	: never;
type OverlayIn<X, K extends AnyKit> = X extends () => infer Y
	? OverlayIn<Y, K>
	: X extends Optional<infer Y>
		? OverlayIn<Y, K>
		: X extends MapT<infer Y>
			? { readonly [key: string]: Overlay<Expand<Y, K>, K> }
			: X extends ListT<infer Y>
				? readonly Overlay<Expand<Y, K>, K>[]
				: X extends AnyEntity | AnyTrait | OneOf<any> | All<any>
					? Overlay<Expand<X, K>, K>
					: ConfigIn<X, K>;
type InputOverrides<E, K extends AnyKit> = {
	[M in keyof Inp<Def<E>>]?: InputIn<Inp<Def<E>>[M], K>;
};

export type NodeFor<E, K extends AnyKit> = E extends AnyEntity
	? {
			type: E["name"];
			meta?: MetaOf<K>;
			inputs?: InputOverrides<E, K>;
		} & ConfigPart<E, K>
	: never;
export type ComponentNode<K extends AnyKit> = {
	use: string;
	params?: Record<string, unknown>;
	meta?: MetaOf<K>;
};
export type NodeOf<K extends AnyKit> =
	| NodeFor<EntityOf<K>, K>
	| ComponentNode<K>;
export type PlacementOf<K extends AnyKit> = NodeFor<EntityOf<K>, K>;

export type ProgramTree<K extends AnyKit> = ConfigPart<RootOf<K>, K> & {
	inputs?: InputOverrides<RootOf<K>, K>;
	functions?: Record<string, { params: readonly string[]; body: BuilderExpr }>;
	components?: Record<
		string,
		{ params?: Record<string, string | { expr: string }>; body: NodeOf<K> }
	>;
};

export interface ProgramBuilder<K extends AnyKit> {
	root: Placed<K>;
	define(
		name: string,
		f: { params: readonly string[]; body: BuilderExpr },
	): void;
	component(
		name: string,
		c: { params?: Record<string, unknown>; body: NodeOf<K> },
	): void;
}
export interface Placed<K extends AnyKit> {
	add(
		slot: string,
		name: string,
		placement: PlacementOf<K>,
		opts?: { meta?: MetaOf<K> },
	): Placed<K>;
	use(
		slot: string,
		name: string,
		component: string,
		params?: Record<string, unknown>,
	): Placed<K>;
}

export interface Diagnostic {
	code: string;
	message: string;
	at: Path;
	field?: string;
	exprPath?: readonly number[];
	meta?: unknown;
	data?: unknown;
}

export interface Program<K extends AnyKit> {
	readonly diagnostics: readonly Diagnostic[];
	run(ops?: readonly Op[]): Session<K>;
	parts(): Iterable<NodeOf<K> & { path: Path }>;
	dependencies(path: Path): { reads: Path[]; readBy: Path[] };
}

export type Op =
	| { t: "set"; at: Path; v: Json; clock?: string }
	| { t: "clear"; at: Path; clock?: string }
	| {
			t: "add";
			at: Path;
			id?: string;
			key?: string;
			order: string;
			clock?: string;
	  }
	| { t: "move"; at: Path; order: string; clock?: string }
	| { t: "remove"; at: Path; clock?: string };

export interface Session<K extends AnyKit> {
	readonly root: Handle<RootOf<K>, K>;
	at<const P extends readonly Segment[]>(path: P): At<K, P> | undefined;
	issues(): readonly Issue[];
	apply(op: Op | readonly Op[]): void;
	batch(f: () => void): void;
	onApply(f: (op: Op) => void): () => void;
	ops(): readonly Op[];
	snapshot(): Json;
	explain(m: Member<unknown>): unknown;
}
/** A name, a position, or a row by the id the program gave it. */
type Segment = string | number | { readonly id: string };

// ---------- the Operator's side: handles ----------

export interface Member<V> {
	get(): Result<V>;
	subscribe(listener: () => void): () => void;
	issues(): readonly Issue[];
}
export interface InputMember<V> extends Member<V> {
	set(v: In<V>): Result<Op>;
	clear(): Op;
	writable(): boolean;
	isSet(): boolean;
}
type MemberHandle<V, W> = W extends true
	? InputMember<V>
	: Member<V> & { writable(): false };

type ValueKind<X> = X extends () => infer Y
	? ValueKind<Y>
	: X extends Initial<any> | ValueType<any> | ExprType<any> | Optional<any>
		? "value"
		: X extends ListT<infer Y>
			? Y extends ValueType<any>
				? "value"
				: "list"
			: X extends MapT<any>
				? "map"
				: "entity";
type DerivedKind<X> =
	X extends Ex<KnownN<infer V>>
		? V extends DerivedEntity<any>
			? "entity"
			: "value"
		: "value";
type KindOf<D, M> = M extends keyof Inp<D>
	? ValueKind<Inp<D>[M]>
	: M extends keyof Cfg<D>
		? ValueKind<Cfg<D>[M]>
		: M extends keyof Der<D>
			? DerivedKind<Der<D>[M]>
			: never;
type MembersOfKind<E, Kd> = {
	[M in keyof Inp<Def<E>> | keyof Cfg<Def<E>> | keyof Der<Def<E>>]: KindOf<
		Def<E>,
		M
	> extends Kd
		? M
		: never;
}[keyof Inp<Def<E>> | keyof Cfg<Def<E>> | keyof Der<Def<E>>] &
	string;
type MemberType<E, M> = M extends keyof Inp<Def<E>>
	? Inp<Def<E>>[M]
	: M extends keyof Cfg<Def<E>>
		? Cfg<Def<E>>[M]
		: M extends keyof Der<Def<E>>
			? Der<Def<E>>[M] extends Ex<KnownN<infer V>>
				? V
				: never
			: never;
type ElemType<X> = X extends () => infer Y
	? ElemType<Y>
	: X extends ListT<infer Y> | MapT<infer Y>
		? Y
		: never;
type ImplementedTraits<E> =
	Def<E> extends { impls: infer Im extends readonly unknown[] }
		? Im[number] extends infer I
			? I extends Impl<infer T>
				? T
				: never
			: never
		: never;

export interface EntityHandle<E extends AnyEntity, K extends AnyKit> {
	readonly type: E["name"];
	readonly id: string;
	readonly meta: MetaOf<K>;
	readonly parent: Handle<EntityOf<K>, K> | undefined;
	readonly "~impl": ImplNames<E>;
	member<M extends MembersOfKind<E, "value">>(
		m: M,
	): MemberHandle<MemberValue<Def<E>, M>, MemberIsWritable<Def<E>, M>>;
	as<T extends ImplementedTraits<E>>(trait: T): TraitHandle<T, K>;
	entity<M extends MembersOfKind<E, "entity">>(
		m: M,
	): Handle<Expand<MemberType<E, M>, K>, K>;
	list<M extends MembersOfKind<E, "list">>(
		m: M,
	): ListHandle<Expand<ElemType<MemberType<E, M>>, K>, K>;
	map<M extends MembersOfKind<E, "map">>(
		m: M,
	): MapHandle<Expand<ElemType<MemberType<E, M>>, K>, K>;
	issues(): readonly Issue[];
}
export interface TraitHandle<T extends AnyTrait, K extends AnyKit> {
	member<M extends keyof T["~members"] & string>(
		m: M,
	): Member<ValueOfType<T["~members"][M]>>;
	entity<M extends keyof T["~members"] & string>(
		m: M,
	): Handle<Expand<T["~members"][M], K>, K>;
}
export interface ListHandle<E, K extends AnyKit> {
	add(): Handle<E, K>;
	insert(index: number): Handle<E, K>;
	move(id: string, index: number): void;
	remove(id: string): void;
	at(index: number): Handle<E, K> | undefined;
	entries(): [id: string, handle: Handle<E, K>][];
}
export interface MapHandle<E, K extends AnyKit> {
	add(key: string): Handle<E, K>;
	get(key: string): Handle<E, K> | undefined;
	remove(key: string): void;
	entries(): [key: string, handle: Handle<E, K>][];
}

export type Handle<X, K extends AnyKit = RegisteredKit> = X extends AnyEntity
	? EntityHandle<X, K>
	: X extends AnyTrait
		? TraitHandle<X, K>
		: never;

export declare function has<H extends { "~impl": string }, T extends AnyTrait>(
	h: H,
	trait: T,
): h is H extends any ? (T["name"] extends H["~impl"] ? H : never) : never;

// ---------- session.at: walk a path through the kit ----------

type Pos =
	| { ent: AnyEntity }
	| { coll: unknown; kind: "list" | "map" }
	| { value: unknown };
type StepEntity<E, S, K extends AnyKit> = E extends AnyEntity
	? S extends MemberNamesOf<E>
		? KindOf<Def<E>, S> extends "list" | "map"
			? { coll: Expand<ElemType<MemberType<E, S>>, K>; kind: KindOf<Def<E>, S> }
			: KindOf<Def<E>, S> extends "entity"
				? { ent: Expand<MemberType<E, S>, K> }
				: KindOf<Def<E>, S> extends "value"
					? { value: MemberValue<Def<E>, S> }
					: never
		: never
	: never;
type MemberNamesOf<E> = (
	| keyof Inp<Def<E>>
	| keyof Cfg<Def<E>>
	| keyof Der<Def<E>>
) &
	string;
type Walk<
	P extends Pos,
	Ss extends readonly Segment[],
	K extends AnyKit,
> = Ss extends readonly [infer S, ...infer Rest extends readonly Segment[]]
	? P extends { ent: infer E }
		? Walk<Merge<StepEntity<E, S, K>>, Rest, K>
		: P extends { coll: infer X }
			? Walk<{ ent: Extract<X, AnyEntity> }, Rest, K>
			: never
	: P;
/** union of positions from a union of entities, collapsed */
type Merge<P> = [P] extends [never]
	? never
	: P extends { ent: any }
		? { ent: P["ent"] }
		: P;
type Out<P, K extends AnyKit> = P extends { ent: infer E }
	? Handle<E, K>
	: P extends { coll: infer X; kind: "list" }
		? ListHandle<X, K>
		: P extends { coll: infer X; kind: "map" }
			? MapHandle<X, K>
			: P extends { value: infer V }
				? Member<V>
				: never;
export type At<K extends AnyKit, P extends readonly Segment[]> = Out<
	Walk<{ ent: RootOf<K> }, P, K>,
	K
>;
