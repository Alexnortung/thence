import type { Address, Located, Plan, Shape } from "./types";

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
		if (placed?.kind === "entity") {
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
			next = input.of;
			i += 2;
		}
		if (next === undefined || i > at.length) return undefined;
		parent = here;
		here = at.slice(0, i);
		shape = plan.shapes.get(next) as Shape | undefined;
	}
	return undefined;
}
