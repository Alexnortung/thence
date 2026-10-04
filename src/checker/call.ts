import {
	type FnSpec,
	type KitFn,
	type ParamType,
	paramList,
	type TypeSpec,
} from "../kit";
import { Decimal, FnError, fail, ok, type Result } from "../values";

/**
 * Calls a function's `impl` signatures with argument values: the first
 * signature whose parameters take the values is used, and a `null` fits only
 * a nullable parameter: a function that has an answer for an empty argument
 * says so in its parameter's type. Values no signature takes are
 * `call.types`. A number result that isn't finite is `number.overflow`.
 *
 * The signature is picked from the values at run time. When the checker
 * knows every expression's type (#14), it will pick it once, and a call that
 * fits no signature will be a diagnostic instead of an error value.
 */
export function invoke(f: KitFn, args: readonly unknown[]): Result<unknown> {
	const impls = f.signatures.filter(
		(s) => s.impl && s.params.length === args.length,
	);
	const taking = impls.find((s) => takes(s, args));
	if (taking?.impl) return run(f.name, taking.impl, named(f, taking, args));
	return fail(
		"call.types",
		`"${f.name}" doesn't take ${args.map(describe).join(", ") || "no arguments"}`,
	);
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
		const params = paramList(f.name, signature);
		const name = params[j]?.[0];
		const inverse = name === undefined ? undefined : signature.inverse?.[name];
		if (!inverse || params.length !== args.length) continue;
		const result = fitResult(signature, target);
		if (result === undefined) continue;
		const named: Record<string, unknown> = { result: result.value };
		let fits = true;
		let nulled = false;
		params.forEach(([param, type], i) => {
			const v = args[i];
			const spec = valueSpec(type);
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
		return r.ok || r.error.code !== "number.overflow"
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
			? paramType(signature, signature.returns)
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

/** The type of a signature's parameter named `name`. */
function paramType(signature: FnSpec, name: string): ParamType | undefined {
	return signature.params.find((p) => Object.hasOwn(p, name))?.[name];
}

/** Whether a signature takes these values. */
function takes(signature: FnSpec, args: readonly unknown[]): boolean {
	return signature.params.every((entry, i) => {
		const spec = valueSpec(Object.values(entry)[0] as ParamType);
		const v = args[i];
		return v === null ? spec.nullable : accepts(spec, v);
	});
}

/** The arguments by parameter name, as an `impl` takes them. */
function named(
	f: KitFn,
	signature: FnSpec,
	args: readonly unknown[],
): Record<string, unknown> {
	return Object.fromEntries(
		paramList(f.name, signature).map(([name], i) => [name, args[i]]),
	);
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
