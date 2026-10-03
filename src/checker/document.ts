// Paths into a value, such as `["ref", "$root", "data", "email", "value"]`
// into your data document. The checker follows the path through the
// expression that builds the value (`record`, `entry`, `merge`, and
// references to other values) to what it names there, so the reference
// depends only on that, and a total can read the document that stores it
// without a cycle.

import type { Inside, Owner, Resolved } from "./paths";

/** What following a path into a value gave. */
export type Followed =
	/** An expression to compile in the reference's place, with its paths from the reference's scope. */
	| { readonly kind: "expr"; readonly expr: unknown }
	/** The value has nothing there, such as a key no `record` or `entry` makes. */
	| { readonly kind: "null" }
	/** The checker can't tell before anything runs: the reference reads the whole value and looks inside it. */
	| { readonly kind: "whole" }
	| { readonly kind: "error"; readonly code: string; readonly message: string };

/** What following needs from the checker, in the reference's scope. */
export interface Document {
	resolve(path: readonly unknown[]): Resolved;
	/** The expression that computes a value; `undefined` for an input. */
	expression(
		owner: Owner,
	): { readonly expr: unknown; readonly builder: boolean } | undefined;
	/** The ids of the elements the program placed in a collection; `undefined` for an Operator's. */
	elements(path: readonly unknown[]): readonly string[] | undefined;
}

const NULL: Followed = { kind: "null" };
const WHOLE: Followed = { kind: "whole" };
/** How many values deep a path may lead before the checker calls it a loop. */
const DEPTH = 64;

/**
 * Follows a path that goes on inside a value through the value's
 * expression. Only your own expressions are followed: a Builder's formula
 * is read whole.
 */
export function follow(inside: Inside, doc: Document, depth = 0): Followed {
	if (depth > DEPTH) {
		return {
			kind: "error",
			code: "cycle",
			message: "this path leads back into itself",
		};
	}
	const exprs = inside.owners.map((o) => doc.expression(o));
	const first = exprs[0];
	const one = JSON.stringify(first?.expr);
	if (
		!first ||
		exprs.some((x) => !x || x.builder || JSON.stringify(x.expr) !== one)
	) {
		return WHOLE;
	}
	return new Follower(doc, depth).into(
		first.expr,
		inside.instance,
		inside.key,
		inside.rest,
	);
}

/** One path being followed. */
class Follower {
	readonly #doc: Document;
	readonly #depth: number;

	constructor(doc: Document, depth: number) {
		this.#doc = doc;
		this.#depth = depth;
	}

	/**
	 * What `rest` names inside the value of `expr`, an expression of the
	 * instance at `instance`, whose key is `key`.
	 */
	into(
		expr: unknown,
		instance: readonly unknown[],
		key: string | undefined,
		rest: readonly unknown[],
	): Followed {
		if (rest.length === 0) {
			const moved = relocate(expr, instance);
			return moved === undefined ? WHOLE : { kind: "expr", expr: moved };
		}
		if (!Array.isArray(expr)) return NULL;
		const [name, ...args] = expr as [unknown, ...unknown[]];
		switch (name) {
			case "ref": {
				const target = through(args, instance, rest);
				return target === undefined ? WHOLE : this.#path(target);
			}
			case "text":
				return NULL;
			case "record": {
				const fields = asRecord(args[0]) ?? {};
				const [k, ...more] = rest;
				return typeof k === "string" && Object.hasOwn(fields, k)
					? this.into(fields[k], instance, key, more)
					: NULL;
			}
			case "entry": {
				const k = keyOf(args[0], key);
				if (args.length !== 2 || k === undefined) return WHOLE;
				return k === rest[0]
					? this.into(args[1], instance, key, rest.slice(1))
					: NULL;
			}
			case "merge":
				return this.#merge(args, instance, key, rest);
			default:
				return WHOLE;
		}
	}

	/** The one part of a merge that has the key; two is an error, as when the merge runs. */
	#merge(
		args: readonly unknown[],
		instance: readonly unknown[],
		key: string | undefined,
		rest: readonly unknown[],
	): Followed {
		const found: Followed[] = [];
		for (const arg of args) {
			const parts = this.#elements(arg, instance);
			if (parts === "unknown") return WHOLE;
			const each = parts
				? parts.map((path) => this.#path([...path, ...rest]))
				: [this.into(arg, instance, key, rest)];
			for (const f of each) {
				if (f.kind === "whole" || f.kind === "error") return f;
				if (f.kind === "expr") found.push(f);
			}
		}
		if (found.length > 1) {
			return {
				kind: "error",
				code: "merge.duplicate",
				message: `"${String(rest[0])}" is in more than one of the merged objects`,
			};
		}
		return found[0] ?? NULL;
	}

	/**
	 * For `merge(list)`: the path to each element's value, when the program
	 * placed the elements; `unknown` for an Operator's collection;
	 * `undefined` when `arg` isn't a list.
	 */
	#elements(
		arg: unknown,
		instance: readonly unknown[],
	): readonly (readonly unknown[])[] | "unknown" | undefined {
		if (!isRef(arg)) return undefined;
		const path = arg.slice(1);
		const i = path.indexOf("$each");
		if (i < 0) return undefined;
		const list = [...instance, ...path.slice(0, i)];
		const ids = this.#doc.elements(list);
		if (!ids) return "unknown";
		return ids.map((id) => [...list, id, ...path.slice(i + 1)]);
	}

	/** A path from the reference's scope, followed into whatever value it ends in. */
	#path(path: readonly unknown[]): Followed {
		const r = this.#doc.resolve(path);
		if (r.kind === "inside") return follow(r, this.#doc, this.#depth + 1);
		if (r.kind === "error") return r;
		return { kind: "expr", expr: ["ref", ...path] };
	}
}

/**
 * Where a reference in a value's expression leads once the rest of the
 * path is added: `rest` picks an element by `"$each"` or `{"at"}` when the
 * reference is a list. `undefined` when the reference only means something
 * where it is, such as `$key`.
 */
function through(
	ref: readonly unknown[],
	instance: readonly unknown[],
	rest: readonly unknown[],
): readonly unknown[] | undefined {
	if (!movable(ref)) return undefined;
	const i = ref.indexOf("$each");
	if (i < 0) return [...instance, ...ref, ...rest];
	const [pick, ...more] = rest;
	if (pick === "$each") return [...instance, ...ref, ...more];
	const at = asRecord(pick)?.at;
	if (typeof at !== "number") return undefined;
	return [
		...instance,
		...ref.slice(0, i),
		{ at },
		...ref.slice(i + 1),
		...more,
	];
}

/** The expression, with each path starting from `instance`; `undefined` when one can't. */
function relocate(expr: unknown, instance: readonly unknown[]): unknown {
	if (instance.length === 0) return expr;
	let stuck = false;
	const move = (x: unknown): unknown => {
		if (!Array.isArray(x)) return x;
		const [name, ...args] = x as [unknown, ...unknown[]];
		if (name === "ref") {
			if (!movable(args)) stuck = true;
			return ["ref", ...instance, ...args];
		}
		if (name === "text" || name === "error") return x;
		return [
			name,
			...args.map((a) => {
				const named = asRecord(a);
				return named
					? Object.fromEntries(
							Object.entries(named).map(([k, v]) => [k, move(v)]),
						)
					: move(a);
			}),
		];
	};
	const moved = move(expr);
	return stuck ? undefined : moved;
}

/** Whether a reference means the same from further out, which `$key`, `$index`, `$prev` and `$next` don't. */
function movable(ref: readonly unknown[]): boolean {
	const first = ref[0];
	return !(typeof first === "string" && first.startsWith("$"));
}

/** The key an `entry` gets, when the checker knows it. */
function keyOf(x: unknown, key: string | undefined): string | undefined {
	if (!Array.isArray(x)) return undefined;
	if (x[0] === "text" && typeof x[1] === "string") return x[1];
	if (x[0] === "ref" && x[1] === "$key" && x.length === 2) return key;
	return undefined;
}

function isRef(x: unknown): x is readonly ["ref", ...unknown[]] {
	return Array.isArray(x) && x[0] === "ref";
}

function asRecord(x: unknown): Record<string, unknown> | undefined {
	return typeof x === "object" && x !== null && !Array.isArray(x)
		? (x as Record<string, unknown>)
		: undefined;
}
