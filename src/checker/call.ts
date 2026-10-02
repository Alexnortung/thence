import type { FnSpec, KitFn, ParamType, TypeSpec } from "../kit";
import { Decimal, FnError, fail, ok, type Result } from "../values";

/**
 * Calls a function's `impl` signatures with argument values: the first
 * signature whose parameters the values fit is used. A `null` argument for a
 * parameter that isn't nullable makes the result `null`, and a number result
 * that isn't finite is `number.overflow`.
 *
 * The signature is picked from the values at run time. When the checker
 * knows every expression's type (#14), it will pick it once, and a call that
 * fits no signature will be a diagnostic instead of an error value.
 */
export function invoke(f: KitFn, args: readonly unknown[]): Result<unknown> {
	for (const signature of f.signatures) {
		if (!signature.impl) continue;
		const names = Object.keys(signature.params);
		if (names.length !== args.length) continue;
		let nulled = false;
		let fits = true;
		const named: Record<string, unknown> = {};
		names.forEach((name, i) => {
			const v = args[i];
			const spec = valueSpec(signature.params[name] as ParamType);
			named[name] = v;
			if (v === null) nulled ||= !spec.nullable;
			else fits &&= accepts(spec, v);
		});
		if (!fits) continue;
		if (nulled) return ok(null);
		return run(f.name, signature, named);
	}
	return fail(
		"call.types",
		`"${f.name}" doesn't take ${args.map(describe).join(", ") || "no arguments"}`,
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
