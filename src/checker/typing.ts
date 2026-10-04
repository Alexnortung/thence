import type { ParamType, TypeSpec } from "../kit";

/**
 * What the checker knows about an expression's value before anything runs.
 * `json` stands for "any value": the checker doesn't know more, as for a
 * `t.json` member or a Builder function's parameter, and leaves the rest to
 * run time.
 */
export interface StaticType {
	readonly base: TypeSpec["base"] | "null";
	readonly nullable: boolean;
	/** A custom type's name, as in `t.decimal("Money", …)`. */
	readonly name?: string;
	readonly scale?: number;
	readonly values?: readonly string[];
	/** A number written as a literal, which also fits an `int` when whole, or a decimal slot. */
	readonly literal?: number;
	/** For a number type: when two rounds of a cycle count as the same. */
	readonly converge?: TypeSpec["converge"];
	/** A list, as a path through `$each` gives outside an aggregate: it only goes where any value goes. */
	readonly list?: boolean;
}

/** A list of values, as JSON. */
export const LIST: StaticType = { base: "json", nullable: false, list: true };

export const ANY: StaticType = { base: "json", nullable: true };
export const NULL: StaticType = { base: "null", nullable: true };

/** A declared type, as the checker tracks it. */
export function fromSpec(spec: TypeSpec): StaticType {
	return {
		base: spec.base,
		nullable: spec.nullable,
		...(spec.name === undefined ? {} : { name: spec.name }),
		...(spec.scale === undefined ? {} : { scale: spec.scale }),
		...(spec.values === undefined ? {} : { values: spec.values }),
		...(spec.converge === undefined ? {} : { converge: spec.converge }),
	};
}

/** A parameter's type; for a list parameter, its elements'. */
export function paramSpec(param: ParamType): TypeSpec {
	return param["~kind"] === "list" ? param["~of"].spec : param.spec;
}

export function nullable(t: StaticType): StaticType {
	return t.nullable ? t : { ...t, nullable: true };
}

/** The same type without its literal, as a call's result carries an argument's type. */
export function widen(t: StaticType): StaticType {
	if (t.literal === undefined) return t;
	const { literal: _, ...rest } = t;
	return rest;
}

/** How an argument of some type fits a parameter; see {@link fitsParam}. */
export type Fit = "yes" | "no" | "maybe" | "nulls";

/**
 * Whether an argument of type `t` fits a parameter. `maybe` when the checker
 * can't know, so the signature is picked at run time. `nulls` when the
 * argument may be `null` and the parameter isn't nullable: its other values
 * fit, and a `null` goes to a signature that takes it, or makes the call
 * `null` when the signature has `forwardNull` (see `invoke`).
 */
export function fitsParam(param: TypeSpec, t: StaticType): Fit {
	if (t.list) return param.base === "json" ? "yes" : "no";
	if (t.base === "json") return param.base === "json" ? "yes" : "maybe";
	if (t.base === "null") return param.nullable ? "yes" : "nulls";
	if (!sameKind(param, t)) return "no";
	return t.nullable && !param.nullable ? "nulls" : "yes";
}

/**
 * Why a value of type `t` can't go where `slot` is declared, such as a
 * config formula's `t.expr(Money)` or a trait member; `undefined` when it
 * fits. A nullable value fits only a nullable slot.
 */
export function misfit(
	slot: TypeSpec,
	t: StaticType,
): { code: string; message: string } | undefined {
	if (t.list && slot.base !== "json") {
		return {
			code: "ref.list",
			message: `this goes through "$each", so it is a list, where ${describe(fromSpec(slot))} goes: pass it to an aggregate such as sum`,
		};
	}
	if (t.base === "json" || slot.base === "json") return undefined;
	if (t.base !== "null" && !sameKind(slot, t) && !coerces(slot, t)) {
		return {
			code: "type.mismatch",
			message: `this is ${describe(t)}, where ${describe(fromSpec(slot))} goes`,
		};
	}
	if (t.nullable && !slot.nullable) {
		return {
			code: "type.nullable",
			message: `this can be empty, where ${describe(fromSpec(slot))} can't`,
		};
	}
	return undefined;
}

/** Whether a number literal becomes a value of the slot's type: a decimal, or an `int` when whole. */
export function coerces(slot: TypeSpec, t: StaticType): boolean {
	return (
		t.literal !== undefined &&
		(slot.base === "decimal" ||
			(slot.base === "int" && Number.isSafeInteger(t.literal)))
	);
}

/**
 * Whether `t` is a value of the declared type: the same base (an `int` is a
 * number, an enum or a date is text), and for a custom type the same name;
 * a decimal type with a scale takes only that scale.
 */
function sameKind(spec: TypeSpec, t: StaticType): boolean {
	if (spec.name !== undefined && t.name !== undefined && spec.name !== t.name) {
		return false;
	}
	switch (spec.base) {
		case "number":
			return t.base === "number" || t.base === "int";
		case "int":
			return (
				t.base === "int" ||
				(t.literal !== undefined && Number.isSafeInteger(t.literal))
			);
		case "decimal":
			return (
				t.base === "decimal" &&
				(spec.scale === undefined || t.scale === spec.scale)
			);
		case "text":
			return t.base === "text" || t.base === "enum" || t.base === "date";
		case "enum":
			return (
				t.base === "enum" &&
				(spec.values === undefined ||
					(t.values?.every((v) => spec.values?.includes(v)) ?? false))
			);
		case "json":
			return true;
		default:
			return t.base === spec.base;
	}
}

/** "a Money", "a number", "an enum", for messages. */
export function describe(t: StaticType): string {
	if (t.base === "null") return "null";
	if (t.list) return "a list";
	const what = t.name ?? t.base;
	return `${/^[aeiouAEIOU]/.test(what) ? "an" : "a"} ${what}${t.nullable ? " or null" : ""}`;
}

/**
 * One type for a value read from several entities, as a path through a
 * trait or `t.oneOf` does: their own when they agree, otherwise any value.
 */
export function join(types: readonly StaticType[]): StaticType {
	const [first, ...rest] = types;
	if (!first) return ANY;
	const nullable = types.some((t) => t.nullable);
	const same = rest.every(
		(t) =>
			t.base === first.base && t.name === first.name && t.scale === first.scale,
	);
	return same ? { ...widen(first), nullable } : ANY;
}
