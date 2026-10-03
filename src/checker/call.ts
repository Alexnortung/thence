import type { FnSpec, KitFn, ParamType, TypeSpec } from "../kit";
import { Decimal, FnError, fail, ok, type Result } from "../values";

/**
 * Calls a function's `impl` signatures with argument values: the first
 * signature whose parameters the values fit is used. A `null` argument for a
 * parameter that isn't nullable makes the result `null`; a number result
 * that is infinite is `number.overflow`, `NaN` is `number.nan`, and `-0` is
 * `0`.
 *
 * The checker picks the signature once when it knows the arguments' types,
 * and calls {@link invokeSignature}; this is for the calls it can't, such as
 * on a `t.json` value.
 */
export function invoke(f: KitFn, args: readonly unknown[]): Result<unknown> {
	for (const signature of f.signatures) {
		const r = call(f.name, signature, args);
		if (r) return r;
	}
	return fail(
		"call.types",
		`"${f.name}" doesn't take ${args.map(describe).join(", ") || "no arguments"}`,
	);
}

/** Calls one `impl` signature the checker picked, as {@link invoke} does. */
export function invokeSignature(
	name: string,
	signature: FnSpec,
	args: readonly unknown[],
): Result<unknown> {
	return (
		call(name, signature, args) ??
		fail(
			"call.types",
			`"${name}" doesn't take ${args.map(describe).join(", ") || "no arguments"}`,
		)
	);
}

/** Calls the signature, or `undefined` when the values don't fit it. */
function call(
	name: string,
	signature: FnSpec,
	args: readonly unknown[],
): Result<unknown> | undefined {
	if (!signature.impl) return undefined;
	const names = Object.keys(signature.params);
	if (names.length !== args.length) return undefined;
	let nulled = false;
	let fits = true;
	const named: Record<string, unknown> = {};
	names.forEach((param, i) => {
		const v = args[i];
		const spec = valueSpec(signature.params[param] as ParamType);
		named[param] = v;
		if (v === null) nulled ||= !spec.nullable;
		else fits &&= accepts(spec, v);
	});
	if (!fits) return undefined;
	if (nulled) return ok(null);
	return run(name, signature.impl, named);
}

/**
 * Works a call back to one argument: the value argument `j` needs for the
 * call to give `target`, with the other arguments as they are. Uses the
 * first `impl` signature that has an inverse for that parameter and fits the
 * other arguments and the target. `write.noAnswer` when no value gives it.
 *
 * @param args - every argument's value now; argument `j`'s is only used to pick the signature
 */
export function invert(
	f: KitFn,
	j: number,
	args: readonly unknown[],
	target: unknown,
): Result<unknown> {
	for (const signature of f.signatures) {
		const names = Object.keys(signature.params);
		const name = names[j];
		const inverse = name === undefined ? undefined : signature.inverse?.[name];
		if (!inverse || names.length !== args.length) continue;
		const result = fitResult(signature, target);
		if (result === undefined) continue;
		const named: Record<string, unknown> = { result: result.value };
		let fits = true;
		let nulled = false;
		names.forEach((param, i) => {
			const v = args[i];
			const spec = valueSpec(signature.params[param] as ParamType);
			named[param] = v;
			if (v === null) nulled ||= i !== j && !spec.nullable;
			else fits &&= accepts(spec, v);
		});
		if (!fits) continue;
		if (nulled || result.value === null) {
			return fail(
				"write.noAnswer",
				`"${f.name}" has no answer while an argument is empty`,
			);
		}
		const r = run(f.name, inverse, named);
		return r.ok || !r.error.code.startsWith("number.")
			? r
			: fail("write.noAnswer", r.error.message);
	}
	return fail(
		"write.readonly",
		`"${f.name}" can't be worked back from ${describe(target)}`,
	);
}

/**
 * The target as the signature returns it, or `undefined` when it doesn't
 * fit. A decimal is rounded to the return type's scale, since an inverse
 * further out works at a wider one.
 */
function fitResult(
	signature: FnSpec,
	target: unknown,
): { value: unknown } | undefined {
	const returns =
		typeof signature.returns === "string"
			? signature.params[signature.returns]
			: signature.returns;
	if (!returns) return undefined;
	const spec = valueSpec(returns);
	if (target === null) return spec.nullable ? { value: null } : undefined;
	if (spec.base === "decimal" && target instanceof Decimal) {
		return {
			value: spec.scale === undefined ? target : target.rescale(spec.scale),
		};
	}
	return accepts(spec, target) ? { value: target } : undefined;
}

function run(
	name: string,
	impl: (args: Record<string, unknown>) => unknown,
	named: Record<string, unknown>,
): Result<unknown> {
	let value: unknown;
	try {
		value = impl(named);
	} catch (e) {
		return e instanceof FnError
			? fail(e.code, e.message)
			: fail("fn.threw", `"${name}" threw: ${String(e)}`);
	}
	if (typeof value !== "number") return ok(value);
	if (Number.isNaN(value))
		return fail("number.nan", "the result isn't a number");
	return Number.isFinite(value)
		? ok(value + 0)
		: fail("number.overflow", "the result is too large for a number");
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
