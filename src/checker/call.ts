import type { FnSpec, KitFn, ParamType, TypeSpec } from "../kit";
import { Decimal, FnError, fail, ok, type Result } from "../values";

/**
 * Calls a function's `impl` signatures with argument values: the first
 * signature whose parameters take the values is used, and a `null` fits only
 * a nullable parameter. If no signature takes a `null` but one would take
 * the other arguments, the result is `null`: a function says it has no answer
 * for an empty argument by not making that parameter nullable. A number
 * result that isn't finite is `number.overflow`.
 *
 * The signature is picked from the values at run time. When the checker
 * knows every expression's type (#14), it will pick it once, and a call that
 * fits no signature will be a diagnostic instead of an error value.
 */
export function invoke(f: KitFn, args: readonly unknown[]): Result<unknown> {
	const impls = f.signatures.filter(
		(s) => s.impl && Object.keys(s.params).length === args.length,
	);
	const taking = impls.find((s) => takes(s, args, false));
	if (taking) return run(f.name, taking, named(taking, args));
	if (impls.some((s) => takes(s, args, true))) return ok(null);
	return fail(
		"call.types",
		`"${f.name}" doesn't take ${args.map(describe).join(", ") || "no arguments"}`,
	);
}

/** Whether a signature takes these values; with `skipNull`, any `null` passes. */
function takes(
	signature: FnSpec,
	args: readonly unknown[],
	skipNull: boolean,
): boolean {
	return Object.values(signature.params).every((param, i) => {
		const spec = valueSpec(param as ParamType);
		const v = args[i];
		return v === null ? skipNull || spec.nullable : accepts(spec, v);
	});
}

function named(
	signature: FnSpec,
	args: readonly unknown[],
): Record<string, unknown> {
	return Object.fromEntries(
		Object.keys(signature.params).map((name, i) => [name, args[i]]),
	);
}

function run(
	name: string,
	signature: FnSpec,
	named: Record<string, unknown>,
): Result<unknown> {
	let value: unknown;
	try {
		value = signature.impl?.(named);
	} catch (e) {
		return e instanceof FnError
			? fail(e.code, e.message)
			: fail("fn.threw", `"${name}" threw: ${String(e)}`);
	}
	return typeof value === "number" && !Number.isFinite(value)
		? fail("number.overflow", "the result is too large for a number")
		: ok(value);
}

/** A parameter's value type; for a list parameter, its elements'. */
function valueSpec(param: ParamType): TypeSpec {
	return param["~kind"] === "list" ? param["~of"].spec : param.spec;
}

/** Whether a value that isn't `null` fits a type. */
function accepts(spec: TypeSpec, v: unknown): boolean {
	switch (spec.base) {
		case "number":
			return typeof v === "number";
		case "int":
			return Number.isSafeInteger(v);
		case "decimal":
			return (
				v instanceof Decimal &&
				(spec.scale === undefined || v.scale === spec.scale)
			);
		case "text":
		case "date":
			return typeof v === "string";
		case "bool":
			return typeof v === "boolean";
		case "enum":
			return typeof v === "string" && (spec.values?.includes(v) ?? true);
		case "json":
			return true;
	}
}

function describe(v: unknown): string {
	if (v === null) return "null";
	if (v instanceof Decimal) return "a decimal";
	return `a ${typeof v}`;
}
