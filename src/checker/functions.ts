import { callsIn, type KitFn, recursion, t } from "../kit";
import { FnError } from "../values";
import type { Diagnostic } from "./types";

/**
 * The functions a program's formulas may call: the kit's, plus the Builder's
 * own from the tree's `functions`. A Builder's function is a body, like a
 * kit function with one, so it is inlined where it is called and writes go
 * through it by the same rule.
 *
 * A body reads only its parameters, as `["ref", "cost"]`, and can't call
 * itself, directly or through others. A function with a mistake is reported
 * once, where it is defined, and a call to it computes to `fn.invalid`.
 */
export function withBuilderFunctions(
	kit: Readonly<Record<string, KitFn>>,
	given: unknown,
	report: (d: Diagnostic) => void,
): Readonly<Record<string, KitFn>> {
	const defs = asRecord(given);
	if (!defs) return kit;
	const functions: Record<string, KitFn> = { ...kit };
	const fail = (
		name: string,
		code: string,
		message: string,
		exprPath?: number[],
	) =>
		report({
			code,
			message,
			at: [],
			field: `functions.${name}`,
			...(exprPath ? { exprPath } : {}),
		});

	const valid = new Map<string, { params: string[]; body: unknown }>();
	for (const [name, def] of Object.entries(defs)) {
		if (name in kit) {
			fail(name, "fn.duplicate", `the kit already has a function "${name}"`);
			continue;
		}
		const d = asRecord(def);
		const params = Array.isArray(d?.params)
			? (d.params as unknown[])
			: undefined;
		let ok = true;
		if (
			!params ||
			params.some(
				(p) => typeof p !== "string" || p === "" || p.startsWith("$"),
			) ||
			new Set(params).size !== params.length
		) {
			fail(
				name,
				"fn.params",
				"params is a list of distinct names, none starting with $",
			);
			ok = false;
		}
		const names = (params ?? []).filter(
			(p): p is string => typeof p === "string",
		);
		if (d?.body === undefined) {
			fail(name, "fn.body", "a function needs a body");
			ok = false;
		} else {
			for (const { path, ref } of refsIn(d.body, [])) {
				if (ref.length === 1 && names.includes(ref[0] as string)) continue;
				fail(
					name,
					"fn.scope",
					`${JSON.stringify(ref)} isn't one of the parameters; a function's body reads only its parameters`,
					path,
				);
				ok = false;
			}
		}
		if (ok) valid.set(name, { params: names, body: d?.body });
		else functions[name] = broken(name, names);
	}

	const calls = new Map([...valid].map(([n, d]) => [n, callsIn(d.body)]));
	for (let loop = recursion(calls); loop; loop = recursion(calls)) {
		const name = loop[0] as string;
		fail(
			name,
			"fn.recursive",
			loop.length === 2
				? `"${name}" calls itself`
				: `"${name}" calls itself through ${loop
						.slice(1, -1)
						.map((n) => `"${n}"`)
						.join(", ")}`,
		);
		functions[name] = broken(name, valid.get(name)?.params ?? []);
		valid.delete(name);
		calls.delete(name);
	}

	for (const [name, { params, body }] of valid) {
		functions[name] = {
			"~kind": "fn",
			name,
			signatures: [
				{
					params: params.map((p) => ({ [p]: t.json })),
					returns: t.json,
					body: (args: Record<string, unknown>) => substitute(body, args),
				},
			],
		} as unknown as KitFn;
	}
	return functions;
}

/** A Builder's function with a mistake: every call to it computes to `fn.invalid`. */
function broken(name: string, params: readonly string[]): KitFn {
	return {
		"~kind": "fn",
		name,
		signatures: [
			{
				params: params.map((p) => ({ [p]: t.json })),
				returns: t.json,
				impl: () => {
					throw new FnError(
						"fn.invalid",
						`the function "${name}" has a mistake`,
					);
				},
			},
		],
	} as unknown as KitFn;
}

/** Every `["ref", …]` in an expression, with its position in it. */
function refsIn(
	expr: unknown,
	path: number[],
	into: { path: number[]; ref: unknown[] }[] = [],
): { path: number[]; ref: unknown[] }[] {
	if (Array.isArray(expr)) {
		if (expr[0] === "ref") into.push({ path, ref: expr.slice(1) });
		else if (expr[0] !== "text") {
			expr.forEach((x, i) => {
				if (i > 0 || typeof x !== "string") refsIn(x, [...path, i], into);
			});
		}
	} else {
		const named = asRecord(expr);
		// Named arguments are one object at a position; their parts have no position of their own.
		for (const v of Object.values(named ?? {})) refsIn(v, path, into);
	}
	return into;
}

/** The body with each parameter's `["ref", name]` replaced by the argument's expression. */
function substitute(expr: unknown, args: Record<string, unknown>): unknown {
	if (Array.isArray(expr)) {
		if (expr[0] === "ref") {
			return expr.length === 2 && typeof expr[1] === "string" && expr[1] in args
				? args[expr[1]]
				: expr;
		}
		if (expr[0] === "text") return expr;
		return expr.map((x) => substitute(x, args));
	}
	const named = asRecord(expr);
	return named
		? Object.fromEntries(
				Object.entries(named).map(([k, v]) => [k, substitute(v, args)]),
			)
		: expr;
}

function asRecord(x: unknown): Record<string, unknown> | undefined {
	return typeof x === "object" && x !== null && !Array.isArray(x)
		? (x as Record<string, unknown>)
		: undefined;
}
