import {
	type Address,
	type Ref,
	type Shape,
	type Step,
	traitSegment,
} from "../plan";

/** What a `ref` path names, as the checker sees it before anything runs. */
export type Resolved =
	| { readonly kind: "value"; readonly ref: Ref }
	/** A path through `$each`: one value per element, for an aggregate. */
	| {
			readonly kind: "list";
			readonly list: Address;
			readonly each: readonly Step[];
			/** How far out of the instance the collection's path starts. */
			readonly up?: number;
	  }
	| { readonly kind: "error"; readonly code: string; readonly message: string };

/** The shapes built so far, and the names of the values each will compute. */
export interface Shapes {
	/** The root's shape, where `$root` starts. */
	readonly root: string;
	get(id: string): Shape | undefined;
	/** The names of a shape's computed values, known before they are compiled. */
	valueNames(id: string): ReadonlySet<string>;
	/**
	 * How the shape implements a trait: the names of the members that hold
	 * values, and the own member each of the others stands for. `undefined`
	 * when it doesn't implement it.
	 */
	trait(
		id: string,
		trait: string,
	):
		| {
				readonly values: ReadonlySet<string>;
				readonly aliases: Readonly<Record<string, Address>>;
		  }
		| undefined;
	/** Where the program placed the shape's one instance; `undefined` for the root, or a shape with many instances. */
	holder(id: string): Holder | undefined;
}

/** The instance that holds a placed instance, as a Builder's scope sees it. */
export interface Holder {
	readonly shape: string;
	/** How many segments the placed instance's address adds to the holder's: 1 for an entity, 2 for an element. */
	readonly up: 1 | 2;
	/** The elements of the map the instance sits in, which its formulas see as siblings. */
	readonly siblings?: readonly Placed[];
}

/** An element the program placed. */
export interface Placed {
	readonly id: string;
	readonly shape: string;
}

/** Where an expression is, as its paths see it. */
export interface PathScope {
	/** The shape of the instance the expression is evaluated in. */
	readonly shape: string;
	/**
	 * Whether a Builder wrote it in a `t.expr` config field, so it also sees
	 * the instance's siblings, `$parent` and `$root`. Your own expressions
	 * see only the instance.
	 */
	readonly builder: boolean;
}

/** Where a path has got to. */
type Here =
	| {
			readonly kind: "instance";
			readonly shapes: readonly string[];
			/** Reached through a trait-typed input, which holds one of `shapes` at a time. */
			readonly choice?: boolean;
	  }
	| {
			readonly kind: "collection";
			readonly name: string;
			/** The element shape of an Operator's collection. */
			readonly of?: string;
			/** The elements the program placed. */
			readonly elements?: readonly Placed[];
	  }
	/** After `{"as": …}`: the next segment is one of the trait's members. */
	| {
			readonly kind: "trait";
			readonly trait: string;
			readonly shapes: readonly string[];
	  }
	| { readonly kind: "value"; readonly name: string }
	/** After `$each` over a collection with no elements yet: nothing to check against. */
	| { readonly kind: "unknown" };

/**
 * Resolves a reference's path in the scope of the expression it is in, and
 * names the sibling the entity's own member hid, if one did.
 *
 * A Builder's path starts with the instance's own members, then its
 * siblings; `$parent` and `$root` start further out. Your own expressions
 * see only the instance itself.
 */
export function resolveRef(
	path: readonly unknown[],
	scope: PathScope,
	shapes: Shapes,
): { resolved: Resolved; shadowed?: string } {
	let shape = scope.shape;
	let up = 0;
	let rest = path;
	const error = (code: string, message: string) => ({
		resolved: { kind: "error", code, message } as const,
	});
	if (!scope.builder) {
		const outside = path.find((s) => s === "$parent" || s === "$root");
		if (outside !== undefined) {
			return error(
				"scope.isolated",
				`${outside} is for a Builder's formula; an entity's own expressions see only the entity`,
			);
		}
		return {
			resolved: walk(rest, { kind: "instance", shapes: [shape] }, 0, shapes),
		};
	}

	if (rest[0] === "$root") {
		up = depth(shape, shapes);
		shape = shapes.root;
		rest = rest.slice(1);
	} else {
		while (rest[0] === "$parent") {
			const holder = shapes.holder(shape);
			if (!holder) return error("ref.unknown", "the root has no $parent");
			shape = holder.shape;
			up += holder.up;
			rest = rest.slice(1);
		}
	}

	const first = rest[0];
	const siblings = shapes.holder(shape)?.siblings;
	const sibling =
		typeof first === "string"
			? siblings?.find((e) => e.id === first)
			: undefined;
	if (siblings && sibling && !isOwn(shape, sibling.id, shapes)) {
		const here: Here = { kind: "collection", name: "", elements: siblings };
		return { resolved: walk(rest, here, up + 1, shapes) };
	}
	return {
		resolved: walk(rest, { kind: "instance", shapes: [shape] }, up, shapes),
		...(sibling ? { shadowed: sibling.id } : {}),
	};
}

/**
 * Follows a path from where it starts. A path that only passes the
 * entity's own members and the entities the program placed is static: it
 * becomes a fixed address. A path through an Operator's collection, a
 * position or a trait-typed input is found again at run time, since the
 * element it names can change or go away.
 */
function walk(
	path: readonly unknown[],
	start: Here,
	up: number,
	shapes: Shapes,
): Resolved {
	let here = start;
	const steps: Step[] = [];
	let fixed = true;
	let each: { list: Address; from: number } | undefined;
	const error = (message: string, code = "ref.unknown"): Resolved => ({
		kind: "error",
		code,
		message,
	});
	// A trait member that stands for an own member puts that member's path in its place.
	const queue = [...path];
	let first = true;

	while (queue.length > 0) {
		const segment = queue.shift();
		const isFirst = first;
		first = false;
		if (here.kind === "unknown") {
			steps.push(segment as Step);
			continue;
		}
		if (here.kind === "value") {
			return error(`"${here.name}" holds a value; nothing is inside it`);
		}
		if (segment === "$root" || segment === "$parent") {
			return error(`${segment} can only start a path`);
		}

		if (here.kind === "trait") {
			if (typeof segment !== "string") {
				return error(
					`${JSON.stringify(segment)} isn't a member of ${here.trait}`,
				);
			}
			const { trait } = here;
			const impls = here.shapes.map((id) => shapes.trait(id, trait));
			if (impls.every((i) => i?.values.has(segment))) {
				steps.push(traitSegment(trait), segment);
				here = { kind: "value", name: segment };
				continue;
			}
			const aliases = impls.map((i) => i?.aliases[segment]);
			const alias = aliases[0];
			if (!alias || aliases.some((a) => a === undefined)) {
				return error(`${trait} has no member "${segment}"`);
			}
			if (aliases.some((a) => JSON.stringify(a) !== JSON.stringify(alias))) {
				return error(
					`${trait}.${segment} stands for different members in different entities`,
					"skeleton.unsupported",
				);
			}
			queue.unshift(...alias);
			here = { kind: "instance", shapes: here.shapes };
			continue;
		}

		if (here.kind === "instance") {
			if (isObject(segment) && typeof segment.as === "string") {
				const trait = segment.as;
				const missing = here.shapes.find((id) => !shapes.trait(id, trait));
				if (missing !== undefined) {
					return error(
						`${shapes.get(missing)?.entity ?? missing} doesn't implement ${trait}`,
					);
				}
				here = { kind: "trait", trait, shapes: here.shapes };
				continue;
			}
			if (segment === "$prev" || segment === "$next") {
				if (!isFirst || up > 0)
					return error(`${segment} can only start a path`);
				steps.push({ neighbour: segment === "$prev" ? -1 : 1 });
				fixed = false;
				continue;
			}
			if (typeof segment !== "string" || segment.startsWith("$")) {
				return error(
					`${JSON.stringify(segment)} isn't a member; "$each", {"at"}, {"key"} and {"id"} follow a list or a map, and {"as"} reads through a trait`,
				);
			}
			const next: (Member | undefined)[] = here.shapes.map((id) =>
				member(id, segment, shapes),
			);
			const head = next[0];
			if (!head || next.some((n) => n === undefined)) {
				return error(`there is no member "${segment}" here`);
			}
			if (next.some((n) => n?.kind !== head.kind)) {
				return error(`"${segment}" isn't the same kind of member everywhere`);
			}
			if (head.kind === "instance") {
				const choice = next.some((n) => n?.kind === "instance" && n.choice);
				if (choice && next.length > 1) {
					return error(
						`"${segment}" in different entities isn't supported yet`,
						"skeleton.unsupported",
					);
				}
				here = {
					kind: "instance",
					shapes: unique(
						next.flatMap((n) => (n?.kind === "instance" ? n.shapes : [])),
					),
				};
				steps.push(segment);
				if (choice) {
					// The one instance it holds now, whichever entity that is.
					steps.push({ at: 0 });
					fixed = false;
				}
				continue;
			}
			if (next.length > 1 && head.kind === "collection") {
				return error(
					`"${segment}" in different entities isn't supported yet`,
					"skeleton.unsupported",
				);
			}
			here = head;
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

	if (here.kind !== "value" && here.kind !== "unknown") {
		const what =
			here.kind === "collection"
				? "a collection"
				: here.kind === "trait"
					? "a trait"
					: "an entity";
		return path.length === 0
			? error("a reference needs a path")
			: error(
					`${JSON.stringify(path)} names ${what}, not a value${here.kind === "collection" ? '; add "$each" to read each element' : ""}`,
				);
	}
	const out = up > 0 ? { up } : {};
	if (each) {
		return {
			kind: "list",
			list: each.list,
			each: steps.slice(each.from),
			...out,
		};
	}
	return {
		kind: "value",
		ref: fixed
			? { kind: "member", path: steps as string[], ...out }
			: { kind: "lookup", path: steps, ...out },
	};
}

/** What a member of a shape holds, as a path sees it. */
type Member = Exclude<Here, { kind: "unknown" } | { kind: "trait" }>;

/** One member of a shape, as a path sees it. */
function member(id: string, name: string, shapes: Shapes): Member | undefined {
	const shape = shapes.get(id);
	if (!shape) return undefined;
	const input = shape.inputs[name];
	if (input?.kind === "value" || shapes.valueNames(id).has(name)) {
		return { kind: "value", name };
	}
	if (input?.kind === "choice") {
		return {
			kind: "instance",
			shapes: unique(Object.values(input.options)),
			choice: true,
		};
	}
	if (input) return { kind: "collection", name, of: input.of };
	const placed = shape.placed[name];
	if (placed?.kind === "entity")
		return { kind: "instance", shapes: [placed.shape] };
	if (placed) return { kind: "collection", name, elements: placed.elements };
	return undefined;
}

/** Whether the shape has its own member with this name. */
function isOwn(id: string, name: string, shapes: Shapes): boolean {
	return member(id, name, shapes) !== undefined;
}

/** How many segments the address of the shape's one instance has. */
function depth(id: string, shapes: Shapes): number {
	let n = 0;
	for (let h = shapes.holder(id); h; h = shapes.holder(h.shape)) n += h.up;
	return n;
}

function isObject(x: unknown): x is Record<string, unknown> {
	return typeof x === "object" && x !== null && !Array.isArray(x);
}

function unique<T>(xs: readonly T[]): T[] {
	return [...new Set(xs)];
}
