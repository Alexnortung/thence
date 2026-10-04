import {
	type Address,
	type CyclePlan,
	decode,
	type Ref,
	type Shape,
	traitOf,
	type ValuePlan,
	type ValueTypePlan,
} from "../plan";
import { Decimal, type Json } from "../values";
import type { Holder } from "./paths";
import type { StaticType } from "./typing";

/** A compiled value, as cycle finding sees it. */
export interface ValueNode {
	readonly shape: string;
	/** Its segments inside the instance: `["total"]`, or `["as:priced", "total"]` for a trait's member. */
	readonly suffix: Address;
	readonly plan: ValuePlan;
	readonly type: StaticType;
	/** The `seeds` entry the entity declares for it. */
	readonly seed?: unknown;
	put(plan: ValuePlan): void;
}

/** Where a shape's instance is, relative to the outermost instance it is placed in. */
export interface Placement {
	readonly shape: Shape;
	readonly holder: Holder | undefined;
	/** The shape of the outermost instance: the root, or an element an Operator adds. */
	readonly top: string;
	/** The instance's address from that outermost instance. */
	readonly segments: Address;
}

/**
 * Finds the values that depend on themselves through references to fixed
 * addresses, and gives each a {@link CyclePlan}: the other values of its
 * cycle, in definition order, its seed and when it has converged.
 *
 * Only `member` references make a cycle here. A path through an Operator's
 * collection or a position finds its element at run time, so a cycle
 * through one is caught then, as the error `cycle`.
 */
export function markCycles(
	nodes: readonly ValueNode[],
	placement: (shape: string) => Placement | undefined,
): void {
	const index = new Map(nodes.map((n, i) => [nodeKey(n.shape, n.suffix), i]));
	const edges = nodes.map((n) => {
		const out = new Set<number>();
		for (const ref of n.plan.refs) {
			const to = target(n.shape, ref, placement);
			const i = to && index.get(nodeKey(to.shape, to.suffix));
			if (i !== undefined) out.add(i);
		}
		return out;
	});

	for (const group of components(edges)) {
		const only = group[0] as number;
		if (group.length === 1 && !edges[only]?.has(only)) continue;
		// Definition order: the order the checker met the values in.
		const members = [...group]
			.sort((a, b) => a - b)
			.map((i) => nodes[i] as ValueNode);
		for (const node of members) {
			const from = placement(node.shape);
			if (!from) continue;
			const cycle: CyclePlan = {
				members: members.map((m) => relative(from, m, placement)),
				seed: seedOf(node),
				...(node.type.converge ? { converge: node.type.converge } : {}),
			};
			node.put({ ...node.plan, cycle });
		}
	}
}

function nodeKey(shape: string, suffix: Address): string {
	return JSON.stringify([shape, ...suffix]);
}

/** The value a `member` reference reads, as a shape and the value's segments in it. */
function target(
	shape: string,
	ref: Ref,
	placement: (shape: string) => Placement | undefined,
): { shape: string; suffix: Address } | undefined {
	if (ref.kind !== "member") return undefined;
	let at = shape;
	let up = ref.up ?? 0;
	let path = ref.path;
	while (up > 0) {
		const here = placement(at);
		const holder = here?.holder;
		const outer = holder && placement(holder.shape);
		if (!here || !holder || !outer) return undefined;
		if (up < holder.up) {
			// Out to the map the instance sits in, as a sibling's path reads: go on from its name.
			const segments = here.segments;
			path = [
				...segments.slice(outer.segments.length, segments.length - up),
				...path,
			];
			up = 0;
		} else up -= holder.up;
		at = holder.shape;
	}
	for (let i = 0; i < path.length; i++) {
		const segment = path[i] as string;
		const rest = path.length - i;
		if (traitOf(segment) !== undefined) {
			return rest === 2 ? { shape: at, suffix: path.slice(i) } : undefined;
		}
		if (rest === 1) return { shape: at, suffix: [segment] };
		const placed = placement(at)?.shape.placed[segment];
		if (placed?.kind === "entity") at = placed.shape;
		else if (placed) {
			const element = placed.elements.find((e) => e.id === path[i + 1]);
			if (!element) return undefined;
			at = element.shape;
			i++;
		} else return undefined;
	}
	return undefined;
}

/** Where another value of the cycle is, from the instance of a value in it. */
function relative(
	from: Placement,
	to: ValueNode,
	placement: (shape: string) => Placement | undefined,
): { up: number; path: Address } {
	const there = placement(to.shape)?.segments ?? [];
	let common = 0;
	while (
		common < from.segments.length &&
		common < there.length &&
		from.segments[common] === there[common]
	) {
		common++;
	}
	return {
		up: from.segments.length - common,
		path: [...there.slice(common), ...to.suffix],
	};
}

/** The declared seed, read as the value's type, or the type's zero. */
function seedOf(node: ValueNode): unknown {
	const type = node.type;
	if (node.seed !== undefined) {
		if (type.base === "json" || type.base === "null") return node.seed;
		const plan: ValueTypePlan = {
			base: type.base,
			nullable: type.nullable,
			...(type.scale === undefined ? {} : { scale: type.scale }),
			...(type.values === undefined ? {} : { values: type.values }),
		};
		const r = decode(plan, node.seed as Json, []);
		return r.ok ? r.value : node.seed;
	}
	switch (type.base) {
		case "decimal":
			return Decimal.from(0, type.scale ?? 0);
		case "text":
			return "";
		case "bool":
			return false;
		case "date":
			return "1970-01-01";
		case "enum":
			return type.values?.[0] ?? null;
		case "null":
			return null;
		default:
			// A number, an int, or a value the checker couldn't type.
			return 0;
	}
}

/** Strongly connected components (Tarjan), each as node indexes. */
function components(edges: readonly ReadonlySet<number>[]): number[][] {
	const order = new Array<number>(edges.length).fill(-1);
	const low = new Array<number>(edges.length).fill(0);
	const onStack = new Array<boolean>(edges.length).fill(false);
	const stack: number[] = [];
	const out: number[][] = [];
	let next = 0;
	const visit = (v: number): void => {
		order[v] = low[v] = next++;
		stack.push(v);
		onStack[v] = true;
		for (const w of edges[v] ?? []) {
			if (order[w] === -1) {
				visit(w);
				low[v] = Math.min(low[v] as number, low[w] as number);
			} else if (onStack[w]) {
				low[v] = Math.min(low[v] as number, order[w] as number);
			}
		}
		if (low[v] === order[v]) {
			const group: number[] = [];
			let w: number;
			do {
				w = stack.pop() as number;
				onStack[w] = false;
				group.push(w);
			} while (w !== v);
			out.push(group);
		}
	};
	for (let v = 0; v < edges.length; v++) if (order[v] === -1) visit(v);
	return out;
}
