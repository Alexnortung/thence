import { Decimal, fail, type Json, ok, type Result } from "../values";
import type { Address, ValueTypePlan } from "./types";

/**
 * The JSON codec of each value type, shared by ops, initial values, the
 * Builder's constants and snapshots, so a value means the same everywhere:
 * a decimal is a string at its type's scale, a date is `"2026-09-30"`, and
 * `-0` is `0`.
 */

/** Turns JSON into the value a member of this type holds, or rejects it. */
export function decode(
	type: ValueTypePlan,
	v: Json,
	at: Address,
): Result<unknown> {
	if (v === null) {
		return type.nullable
			? ok(null)
			: fail("op.type", "this value can't be empty", at);
	}
	switch (type.base) {
		case "number":
			if (typeof v === "number" && Number.isFinite(v)) return ok(v + 0);
			break;
		case "int":
			if (Number.isSafeInteger(v)) return ok((v as number) + 0);
			break;
		case "decimal": {
			const d =
				typeof v === "string"
					? Decimal.parse(v, type.scale ?? 0)
					: typeof v === "number" && Number.isFinite(v)
						? Decimal.from(v, type.scale ?? 0)
						: undefined;
			if (d) return ok(d);
			break;
		}
		case "text":
			if (typeof v === "string") return ok(v);
			break;
		case "date":
			if (typeof v === "string" && isDate(v)) return ok(v);
			break;
		case "bool":
			if (typeof v === "boolean") return ok(v);
			break;
		case "enum":
			if (typeof v === "string" && (type.values?.includes(v) ?? true)) {
				return ok(v);
			}
			break;
		case "json":
			return ok(v);
	}
	return fail("op.type", `${JSON.stringify(v)} isn't a ${type.base}`, at);
}

/**
 * A value as an op writes it to an input of this type. A decimal is written
 * at the input's scale; a decimal for a number type becomes a number. With
 * `round`, after an inverse, a number for an `int` is rounded: the value the
 * write went through is computed again from what the input holds.
 */
export function encode(
	type: ValueTypePlan,
	value: unknown,
	round = false,
): Json {
	if (value instanceof Decimal) {
		if (type.base === "decimal") {
			return value.rescale(type.scale ?? value.scale).toJSON();
		}
		if (type.base === "int") return value.rescale(0).toNumber();
		if (type.base === "number") return value.toNumber();
		return value.toJSON();
	}
	if (round && type.base === "int" && typeof value === "number") {
		return Math.round(value);
	}
	return toJson(value);
}

/** Any value as JSON: a decimal through its `toJSON`, `-0` as `0`. */
export function toJson(value: unknown): Json {
	return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

/** A calendar date, `"2026-09-30"`, that exists. */
function isDate(s: string): boolean {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
	if (!m) return false;
	const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const days = [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	return mo >= 1 && mo <= 12 && d >= 1 && d <= (days[mo - 1] as number);
}

function leap(y: number): boolean {
	return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}
