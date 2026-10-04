import {
	type Address,
	type Ref,
	type Shape,
	type Step,
	traitSegment,
} from "../plan";

/**
 * A member a path ends at, in one of the entities it may lead to, so the
 * checker can look up its type.
 */
export interface Owner {
	readonly shape: string;
	readonly name: string;
	/** For a trait's member: the trait. */
	readonly trait?: string;
}

/** What a `ref` path names, as the checker sees it before anything runs. */
export type Resolved =
	| {
			readonly kind: "value";
			readonly ref: Ref;
			/** The member in each entity the path may lead to; none after `$each` over an empty collection. */
			readonly owners: readonly Owner[];
	  }
	/** A path through `$each`: one value per element, for an aggregate. */
	| {
			readonly kind: "list";
			readonly list: Address;
			readonly each: readonly Step[];
			/** How far out of the instance the collection's path starts. */
			readonly up?: number;
			/** Whether it starts at a lambda's element rather than at the instance. */
			readonly param?: true;
			/** The member each element contributes, in each entity the elements may be. */
			readonly owners: readonly Owner[];
	  }
	/**
	 * A path that goes on inside a value, such as into your data document:
	 * the checker follows it through the value's expression; see `document.ts`.
	 */
	| Inside
	| { readonly kind: "error"; readonly code: string; readonly message: string };

/** A path that goes on inside a value. */
export interface Inside {
	readonly kind: "inside";
	/** The path to the instance that holds the value, in the reference's scope. */
	readonly instance: readonly unknown[];
	/** The path to the value itself. */
	readonly value: readonly unknown[];
	/** The value in each entity the path may lead to. */
	readonly owners: readonly Owner[];
	/**
	 * The instance's key in the map the program placed it in, which
	 * `["ref", "$key"]` gives there; `undefined` when it isn't known before
	 * anything runs.
	 */
	readonly key?: string;
	/** What is left of the path, inside the value. */
	readonly rest: readonly unknown[];
}

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
	/**
	 * For a formula in a component's body: the shape of the body's root. Its
	 * paths can't step out of it, so the component means the same wherever
	 * it is placed.
	 */
	readonly sealed?: string;
}

/**
 * Called with where a path got to, when it got to the end: the steps from
 * where it started, whether they are a fixed address, and how far out it
 * started.
 */
type End = (
	here: Here,
	steps: readonly Step[],
	fixed: boolean,
	up: number,
) => void;

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
			/** For a collection computed with `map` or `filter`: the shapes its elements may have. */
			readonly derived?: readonly string[];
			/** Whether it is a map, whose elements have keys. */
			readonly map?: boolean;
	  }
	/** After `{"as": …}`: the next segment is one of the trait's members. */
	| {
			readonly kind: "trait";
			readonly trait: string;
			readonly shapes: readonly string[];
	  }
	| {
			readonly kind: "value";
			readonly name: string;
			readonly owners: readonly Owner[];
	  }
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
	return resolveWith(path, scope, shapes);
}

/** {@link resolveRef}, calling `end` with where the path got to. */
function resolveWith(
	path: readonly unknown[],
	scope: PathScope,
	shapes: Shapes,
	end?: End,
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
			resolved: walk(
				rest,
				{ kind: "instance", shapes: [shape] },
				0,
				shapes,
				[],
				end,
			),
		};
	}

	const sealed = (what: string) =>
		error(
			"scope.sealed",
			`a component's formulas see only the component, so ${what}`,
		);
	if (rest[0] === "$root") {
		if (scope.sealed !== undefined) return sealed("$root isn't in scope");
		up = depth(shape, shapes);
		shape = shapes.root;
		rest = rest.slice(1);
	} else {
		while (rest[0] === "$parent") {
			if (shape === scope.sealed) return sealed("$parent can't step out");
			const holder = shapes.holder(shape);
			if (!holder) return error("ref.unknown", "the root has no $parent");
			shape = holder.shape;
			up += holder.up;
			rest = rest.slice(1);
		}
	}

	const first = rest[0];
	// The siblings of a component's placement are outside it.
	const siblings =
		shape === scope.sealed ? undefined : shapes.holder(shape)?.siblings;
	const sibling =
		typeof first === "string"
			? siblings?.find((e) => e.id === first)
			: undefined;
	const head = path.slice(0, path.length - rest.length);
	if (siblings && sibling && !isOwn(shape, sibling.id, shapes)) {
		const here: Here = {
			kind: "collection",
			name: "",
			elements: siblings,
			map: true,
		};
		return { resolved: walk(rest, here, up + 1, shapes, head, end) };
	}
	return {
		resolved: walk(
			rest,
			{ kind: "instance", shapes: [shape] },
			up,
			shapes,
			head,
			end,
		),
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
	head: readonly unknown[],
	end?: End,
): Resolved {
	let here = start;
	// The path so far, as written but with trait members that stand for own members replaced, for `Inside`.
	const consumed: unknown[] = [...head];
	let instance = consumed.length;
	let key: string | undefined;
	// Where the path last entered an instance, and that instance's key when the next one has a known key.
	let entered: Here = start;
	let nextKey: string | undefined;
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
		if (here.kind === "instance" && here !== entered) {
			entered = here;
			instance = consumed.length;
			key = nextKey;
			nextKey = undefined;
		}
		if (here.kind === "value") {
			return {
				kind: "inside",
				instance: consumed.slice(0, instance),
				value: consumed,
				owners: here.owners,
				...(key === undefined ? {} : { key }),
				rest: queue,
			};
		}
		const segment = queue.shift();
		const isFirst = first;
		first = false;
		consumed.push(segment);
		if (here.kind === "unknown") {
			steps.push(segment as Step);
			continue;
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
				here = {
					kind: "value",
					name: segment,
					owners: here.shapes.map((shape) => ({ shape, name: segment, trait })),
				};
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
			// The alias stands in for `{"as": …}` and the member.
			consumed.splice(-2);
			nextKey = key;
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
			here =
				head.kind === "value"
					? {
							kind: "value",
							name: segment,
							owners: next.flatMap((n) =>
								n?.kind === "value" ? n.owners : [],
							),
						}
					: head;
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
			const shapesOf: readonly string[] = here.of
				? [here.of]
				: (here.derived ?? unique((here.elements ?? []).map((e) => e.shape)));
			here =
				shapesOf.length > 0
					? { kind: "instance", shapes: shapesOf }
					: { kind: "unknown" };
			continue;
		}
		// An Operator's elements, or a derived collection's, are only known when it runs.
		const dynamic = here.of ? [here.of] : here.derived;
		const at = isObject(segment) ? segment.at : undefined;
		if (typeof at === "number") {
			if (dynamic) {
				steps.push({ at });
				fixed = false;
				here = { kind: "instance", shapes: dynamic };
				continue;
			}
			const elements: readonly Placed[] = here.elements ?? [];
			const element: Placed | undefined =
				elements[at < 0 ? elements.length + at : at];
			if (!element) return error(`"${here.name}" has no element at ${at}`);
			steps.push(element.id);
			if (here.map) nextKey = element.id;
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
		if (dynamic) {
			// An Operator's element may not exist, or may go away.
			fixed = false;
			here = { kind: "instance", shapes: dynamic };
			continue;
		}
		const element: Placed | undefined = here.elements?.find((e) => e.id === id);
		if (!element) return error(`"${here.name}" has no element "${id}"`);
		if (here.map) nextKey = id;
		here = { kind: "instance", shapes: [element.shape] };
	}

	end?.(here, steps, fixed, up);
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
	const owners = here.kind === "value" ? here.owners : [];
	if (each) {
		return {
			kind: "list",
			list: each.list,
			each: steps.slice(each.from),
			owners,
			...out,
		};
	}
	return {
		kind: "value",
		ref: fixed
			? { kind: "member", path: steps as string[], ...out }
			: { kind: "lookup", path: steps, ...out },
		owners,
	};
}

/**
 * The ids of the elements the program placed in the collection `path`
 * names; `undefined` for an Operator's collection, whose elements aren't
 * known before anything runs, or for anything else.
 */
export function placedElements(
	path: readonly unknown[],
	scope: PathScope,
	shapes: Shapes,
): readonly string[] | undefined {
	let found: readonly string[] | undefined;
	resolveWith(path, scope, shapes, (here) => {
		if (here.kind === "collection" && here.elements && !here.of) {
			found = here.elements.map((e) => e.id);
		}
	});
	return found;
}

/** A collection a path names, as `map` and `filter` take it. */
export interface CollectionAt {
	/** Its address from where the path starts. */
	readonly list: Address;
	/** How far out of the instance the path starts. */
	readonly up?: number;
	/** The shapes its elements may have. */
	readonly shapes: readonly string[];
	readonly map: boolean;
}

/**
 * The collection `path` names, when it names one at a fixed address;
 * `undefined` for anything else, such as a value or a JSON array.
 */
export function resolveCollection(
	path: readonly unknown[],
	scope: PathScope,
	shapes: Shapes,
): CollectionAt | undefined {
	return collectionWith(path, (end) => resolveWith(path, scope, shapes, end));
}

/**
 * {@link resolveCollection} from an element of a collection, as a lambda's
 * parameter: `path` goes on from the element, whose shape is one of `from`.
 */
export function resolveCollectionIn(
	path: readonly unknown[],
	from: readonly string[],
	shapes: Shapes,
): CollectionAt | undefined {
	return collectionWith(path, (end) =>
		walk(path, { kind: "instance", shapes: from }, 0, shapes, [], end),
	);
}

/** The collection a path ends at, as `run` walks it. */
function collectionWith(
	path: readonly unknown[],
	run: (end: End) => void,
): CollectionAt | undefined {
	let found: CollectionAt | undefined;
	run((here, steps, fixed, up) => {
		if (here.kind !== "collection" || !fixed || path.length === 0) return;
		found = {
			list: steps as Address,
			...(up > 0 ? { up } : {}),
			shapes: here.of
				? [here.of]
				: (here.derived ?? unique((here.elements ?? []).map((e) => e.shape))),
			map: here.map === true,
		};
	});
	return found;
}

/**
 * Resolves a path that starts at a lambda's parameter, an element of a
 * collection whose shape is one of `from`. Its references start at the
 * element, and are marked so.
 */
export function resolveIn(
	path: readonly unknown[],
	from: readonly string[],
	shapes: Shapes,
): Resolved {
	const resolved = walk(
		path,
		{ kind: "instance", shapes: from },
		0,
		shapes,
		[],
	);
	if (resolved.kind === "value") {
		return { ...resolved, ref: { ...resolved.ref, param: true } as Ref };
	}
	if (resolved.kind === "list") return { ...resolved, param: true };
	return resolved;
}

/** Whether a name means something where an expression is, so a lambda's parameter would hide it. */
export function inScope(
	name: string,
	scope: PathScope,
	shapes: Shapes,
): boolean {
	let found = false;
	resolveWith([name], scope, shapes, () => {
		found = true;
	});
	return found;
}

/** What a member of a shape holds, as a path sees it. */
type Member = Exclude<Here, { kind: "unknown" } | { kind: "trait" }>;

/** One member of a shape, as a path sees it. */
function member(id: string, name: string, shapes: Shapes): Member | undefined {
	const shape = shapes.get(id);
	if (!shape) return undefined;
	const input = shape.inputs[name];
	if (input?.kind === "value" || shapes.valueNames(id).has(name)) {
		return { kind: "value", name, owners: [{ shape: id, name }] };
	}
	if (input?.kind === "choice") {
		return {
			kind: "instance",
			shapes: unique(Object.values(input.options)),
			choice: true,
		};
	}
	if (input) {
		return {
			kind: "collection",
			name,
			of: input.of,
			map: input.kind === "map",
		};
	}
	const placed = shape.placed[name];
	if (placed?.kind === "entity")
		return { kind: "instance", shapes: [placed.shape] };
	if (placed?.kind === "derived") {
		return {
			kind: "collection",
			name,
			derived: placed.shapes,
			map: placed.collection === "map",
		};
	}
	if (placed) {
		return {
			kind: "collection",
			name,
			elements: placed.elements,
			map: placed.kind === "map",
		};
	}
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
