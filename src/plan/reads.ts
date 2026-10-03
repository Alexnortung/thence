import { locate } from "./locate";
import type { Address, Plan, Ref, Shape, Step } from "./types";

/**
 * What a program reads, from the plan alone, before anything runs: for
 * `program.dependencies` and `program.dependents`.
 *
 * A path here is an address, except where a reference goes through an
 * Operator's collection: there it shows the step as written, `"$each"`, a
 * position such as `0`, or `"$prev"`.
 */
export type ReadPath = readonly (string | number)[];

/**
 * Every value the program computes at a fixed address: in the root and in
 * every entity the program placed, but not in the elements an Operator
 * adds, which have no address until they exist.
 */
export function values(plan: Plan): Address[] {
	const out: Address[] = [];
	const visit = (shape: Shape | undefined, at: Address): void => {
		if (!shape) return;
		for (const name of Object.keys(shape.values)) out.push([...at, name]);
		for (const [trait, { values }] of Object.entries(shape.traits)) {
			for (const name of Object.keys(values)) {
				out.push([...at, `as:${trait}`, name]);
			}
		}
		for (const [name, placed] of Object.entries(shape.placed)) {
			if (placed.kind === "entity") {
				visit(plan.shapes.get(placed.shape), [...at, name]);
			} else {
				for (const e of placed.elements) {
					visit(plan.shapes.get(e.shape), [...at, name, e.id]);
				}
			}
		}
	};
	visit(plan.shapes.get(plan.root), []);
	return out;
}

/** What the value at `at` reads, one path per reference; empty for anything that isn't a value. */
export function reads(plan: Plan, at: Address): ReadPath[] {
	const found = locate(plan, at);
	if (found?.kind !== "value") return [];
	const owner = at.slice(0, found.trait === undefined ? -1 : -2);
	return found.value.refs.flatMap((ref) => readPath(ref, owner));
}

function readPath(ref: Ref, owner: Address): ReadPath[] {
	const base = (up: number | undefined) =>
		owner.slice(0, owner.length - (up ?? 0));
	switch (ref.kind) {
		case "member":
			return [[...base(ref.up), ...ref.path]];
		case "lookup":
			return [[...base(ref.up), ...ref.path.map(step)]];
		case "fold":
			return [[...base(ref.up), ...ref.list, "$each", ...ref.each.map(step)]];
		case "place":
			return [];
	}
}

function step(s: Step): string | number {
	if (typeof s === "string") return s;
	if ("at" in s) return s.at;
	return s.neighbour < 0 ? "$prev" : "$next";
}
