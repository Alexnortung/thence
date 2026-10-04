import type { Address, Ref, Shape, Step } from "../plan";

/** What a `ref` path names, as the checker sees it before anything runs. */
export type Resolved =
	| { readonly kind: "value"; readonly ref: Ref }
	/** A path through `$each`: one value per element, for an aggregate. */
	| {
			readonly kind: "list";
			readonly list: Address;
			readonly each: readonly Step[];
	  }
	| { readonly kind: "error"; readonly code: string; readonly message: string };

/** The shapes built so far, and the names of the values each will compute. */
export interface Shapes {
	get(id: string): Shape | undefined;
	/** The names of a shape's computed values, known before they are compiled. */
	valueNames(id: string): ReadonlySet<string>;
}

/** An element the program placed. */
interface Placed {
	readonly id: string;
	readonly shape: string;
}

/** Where a path has got to. */
type Here =
	| { readonly kind: "instance"; readonly shapes: readonly string[] }
	| {
			readonly kind: "collection";
			readonly name: string;
			/** The element shape of an Operator's collection. */
			readonly of?: string;
			/** The elements the program placed. */
			readonly elements?: readonly Placed[];
	  }
	| { readonly kind: "value"; readonly name: string }
	/** After `$each` over a collection with no elements yet: nothing to check against. */
	| { readonly kind: "unknown" };

/**
 * Resolves a reference's path from the instance whose shape is `from`.
 *
 * A path that only passes the entity's own members and the entities the
 * program placed is static: it becomes a fixed address. A path through an
 * Operator's collection or a position is found again at run time, since the
 * element it names can change or go away.
 */
export function resolvePath(
	path: readonly unknown[],
	from: string,
	shapes: Shapes,
): Resolved {
	let here: Here = { kind: "instance", shapes: [from] };
	const steps: Step[] = [];
	let fixed = true;
	let each: { list: Address; from: number } | undefined;
	const error = (message: string, code = "ref.unknown"): Resolved => ({
		kind: "error",
		code,
		message,
	});

	for (const [i, segment] of path.entries()) {
		if (here.kind === "unknown") {
			steps.push(segment as Step);
			continue;
		}
		if (here.kind === "value") {
			return error(`"${here.name}" holds a value; nothing is inside it`);
		}
		if (segment === "$root" || segment === "$parent") {
			return error(
				`${segment} comes with scopes (#13)`,
				"skeleton.unsupported",
			);
		}
		if (isObject(segment) && "as" in segment) {
			return error(
				"reading through a trait comes with traits (#13)",
				"skeleton.unsupported",
			);
		}

		if (here.kind === "instance") {
			if (segment === "$prev" || segment === "$next") {
				if (i !== 0) return error(`${segment} can only start a path`);
				steps.push({ neighbour: segment === "$prev" ? -1 : 1 });
				fixed = false;
				continue;
			}
			if (typeof segment !== "string" || segment.startsWith("$")) {
				return error(
					`${JSON.stringify(segment)} isn't a member; "$each", {"at"}, {"key"} and {"id"} follow a list or a map`,
				);
			}
			const next: (Member | undefined)[] = here.shapes.map((id) =>
				member(id, segment, shapes),
			);
			const first = next[0];
			if (!first || next.some((n) => n === undefined)) {
				return error(`there is no member "${segment}" here`);
			}
			if (next.some((n) => n?.kind !== first.kind)) {
				return error(`"${segment}" isn't the same kind of member everywhere`);
			}
			if (first.kind === "instance") {
				here = {
					kind: "instance",
					shapes: unique(
						next.flatMap((n) => (n?.kind === "instance" ? n.shapes : [])),
					),
				};
			} else if (next.length > 1 && first.kind === "collection") {
				return error(
					`"${segment}" in different entities isn't supported yet`,
					"skeleton.unsupported",
				);
			} else here = first;
			steps.push(segment);
			continue;
		}

		// here.kind === "collection"
		if (segment === "$each") {
			if (each) {
				return error(
					"a path with two $each isn't supported yet",
					"skeleton.unsupported",
				);
			}
			if (!fixed) {
				return error(
					"$each after a position isn't supported yet",
					"skeleton.unsupported",
				);
			}
			each = { list: steps.slice() as string[], from: steps.length + 1 };
			steps.push("$each");
			const shapesOf: string[] = here.of
				? [here.of]
				: unique((here.elements ?? []).map((e) => e.shape));
			here =
				shapesOf.length > 0
					? { kind: "instance", shapes: shapesOf }
					: { kind: "unknown" };
			continue;
		}
		const at = isObject(segment) ? segment.at : undefined;
		if (typeof at === "number") {
			if (here.of) {
				steps.push({ at });
				fixed = false;
				here = { kind: "instance", shapes: [here.of] };
				continue;
			}
			const elements: readonly Placed[] = here.elements ?? [];
			const element: Placed | undefined =
				elements[at < 0 ? elements.length + at : at];
			if (!element) return error(`"${here.name}" has no element at ${at}`);
			steps.push(element.id);
			here = { kind: "instance", shapes: [element.shape] };
			continue;
		}
		const id =
			typeof segment === "string"
				? segment
				: isObject(segment) && typeof segment.key === "string"
					? segment.key
					: isObject(segment) && typeof segment.id === "string"
						? segment.id
						: undefined;
		if (id === undefined) {
			return error(
				`${JSON.stringify(segment)} doesn't pick an element of "${here.name}"`,
			);
		}
		steps.push(id);
		if (here.of) {
			// An Operator's element may not exist, or may go away.
			fixed = false;
			here = { kind: "instance", shapes: [here.of] };
			continue;
		}
		const element: Placed | undefined = here.elements?.find((e) => e.id === id);
		if (!element) return error(`"${here.name}" has no element "${id}"`);
		here = { kind: "instance", shapes: [element.shape] };
	}

	if (here.kind === "instance" || here.kind === "collection") {
		const what = here.kind === "instance" ? "an entity" : "a collection";
		return path.length === 0
			? error("a reference needs a path")
			: error(
					`${JSON.stringify(path)} names ${what}, not a value${here.kind === "collection" ? '; add "$each" to read each element' : ""}`,
				);
	}
	if (each) {
		return {
			kind: "list",
			list: each.list,
			each: steps.slice(each.from),
		};
	}
	return {
		kind: "value",
		ref: fixed
			? { kind: "member", path: steps as string[] }
			: { kind: "lookup", path: steps },
	};
}

/** What a member of a shape holds, as a path sees it. */
type Member = Exclude<Here, { kind: "unknown" }>;

/** One member of a shape, as a path sees it. */
function member(id: string, name: string, shapes: Shapes): Member | undefined {
	const shape = shapes.get(id);
	if (!shape) return undefined;
	const input = shape.inputs[name];
	if (input?.kind === "value" || shapes.valueNames(id).has(name)) {
		return { kind: "value", name };
	}
	if (input) return { kind: "collection", name, of: input.of };
	const placed = shape.placed[name];
	if (placed?.kind === "entity")
		return { kind: "instance", shapes: [placed.shape] };
	if (placed) return { kind: "collection", name, elements: placed.elements };
	return undefined;
}

function isObject(x: unknown): x is Record<string, unknown> {
	return typeof x === "object" && x !== null && !Array.isArray(x);
}

function unique<T>(xs: readonly T[]): T[] {
	return [...new Set(xs)];
}
