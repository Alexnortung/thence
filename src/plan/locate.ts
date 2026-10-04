import type {
	Address,
	DerivedPlan,
	InputPlan,
	Located,
	Plan,
	Shape,
} from "./types";

/**
 * Follows an address through the plan's shapes. It knows which elements the
 * program placed, but not which elements an Operator added to a collection;
 * that is the log's business, so any id passes there.
 */
export function locate(plan: Plan, at: Address): Located | undefined {
	return walk(plan, at)?.found;
}

/**
 * The address of the instance that holds the instance at `at`: its parent.
 * `undefined` for the root, or for an address that isn't an instance.
 */
export function parentOf(plan: Plan, at: Address): Address | undefined {
	const w = walk(plan, at);
	return w?.found.kind === "instance" ? w.parent : undefined;
}

/** The segment of an address before a trait's member: `"as:priced"`. */
export function traitSegment(trait: string): string {
	return `as:${trait}`;
}

/** The trait a segment such as `"as:priced"` names, or `undefined` for any other segment. */
export function traitOf(segment: string): string | undefined {
	return segment.startsWith("as:") ? segment.slice(3) : undefined;
}

/**
 * The address where what `at` names is computed and stored. An element of a
 * derived collection made by `filter` is the source's element seen at
 * another address, so `["bigRows", id, "qty"]` is `["rows", id, "qty"]`.
 * Any other address is its own.
 */
export function canonical(plan: Plan, at: Address): Address {
	let out = at;
	for (let i = 0; i < out.length; i++) {
		const owner = out.slice(0, i);
		const found = walk(plan, [...owner, out[i] as string]);
		if (
			found?.found.kind === "derived" &&
			found.found.derived.shape === undefined &&
			i + 1 < out.length
		) {
			const source = sourceOf(owner, found.found.derived);
			out = [...source, ...out.slice(i + 1)];
			// The source may be a filter's element too.
			i = -1;
		}
	}
	return out;
}

/**
 * The address of the collection a derived collection's elements come from,
 * from the address of the instance that holds it.
 */
export function sourceOf(holder: Address, derived: DerivedPlan): Address {
	const { up = 0, path } = derived.source;
	return [...holder.slice(0, holder.length - up), ...path];
}

/** Where an address leads, and the instance that holds the last instance on the way. */
function walk(
	plan: Plan,
	at: Address,
): { found: Located; parent: Address | undefined } | undefined {
	let shape = plan.shapes.get(plan.root);
	let parent: Address | undefined;
	let here: Address = [];
	let i = 0;
	while (shape) {
		if (i === at.length) return { found: { kind: "instance", shape }, parent };
		const name = at[i] as string;
		const trait = traitOf(name);
		if (trait !== undefined) {
			// A trait's member: always the last segment, since aliases never show in an address.
			const member = at[i + 1] as string;
			const value = shape.traits[trait]?.values[member];
			return value && i + 2 === at.length
				? {
						found: { kind: "value", owner: shape, name: member, value, trait },
						parent,
					}
				: undefined;
		}
		const input = shape.inputs[name];
		const value = shape.values[name];
		const placed = shape.placed[name];
		const last = i === at.length - 1;
		if (last && input) {
			return { found: { kind: "input", owner: shape, name, input }, parent };
		}
		if (last && value) {
			return { found: { kind: "value", owner: shape, name, value }, parent };
		}
		let next: string | undefined;
		if (placed?.kind === "derived") {
			if (last) {
				return {
					found: { kind: "derived", owner: shape, name, derived: placed },
					parent,
				};
			}
			// A filter's element has the shape of the source's element with that id.
			const id = at[i + 1] as string;
			const element =
				placed.shape === undefined
					? walk(plan, [...sourceOf(at.slice(0, i), placed), id])
					: undefined;
			next =
				placed.shape ??
				(element?.found.kind === "instance"
					? element.found.shape.id
					: undefined);
			i += 2;
		} else if (placed?.kind === "entity") {
			next = placed.shape;
			i += 1;
		} else if (placed) {
			if (last) {
				return {
					found: { kind: "placed", owner: shape, name, placed },
					parent,
				};
			}
			next = placed.elements.find((e) => e.id === at[i + 1])?.shape;
			i += 2;
		} else if (input && input.kind !== "value" && !last) {
			next =
				input.kind === "choice"
					? input.options[at[i + 1] as string]
					: elementShape(input, at[i + 1] as string);
			i += 2;
		}
		if (next === undefined || i > at.length) return undefined;
		parent = here;
		here = at.slice(0, i);
		shape = plan.shapes.get(next) as Shape | undefined;
	}
	return undefined;
}

/** The shape of the element with this id in an Operator's collection: a starting element's own, or the template's. */
export function elementShape(
	input: Extract<InputPlan, { kind: "list" | "map" }>,
	id: string,
): string {
	return input.initial?.find((e) => e.id === id)?.shape ?? input.of;
}
