import type { KitSpec } from "./kit";
import { membersOf, resolveMember } from "./members";
import type { ProgramBuilder } from "./node";

/** A node of a program's tree as the builder writes it: plain data. */
interface TreeNode {
	type?: string;
	config?: Record<string, unknown>;
	meta?: unknown;
	[k: string]: unknown;
}

/**
 * Runs the step-by-step builder, `kit.program((p) => p.root.add(…))`, and
 * gives the plain tree it describes, the same object `kit.program(tree)`
 * takes. `add` puts a node in a map under its name, or at the end of a list
 * (where the name isn't used). A name placed twice in one map throws, since
 * the second would silently replace the first.
 */
export function buildTree(
	spec: KitSpec,
	build: (p: ProgramBuilder<any>) => void,
): Record<string, unknown> {
	const tree: TreeNode = {};
	const placed = (node: TreeNode, type: string | undefined): any => {
		const entity =
			type === undefined
				? spec.root
				: spec.entities.find((e) => e.name === type);
		const add = (slot: string, name: string, child: TreeNode) => {
			const config = valueAt(node, "config", () => ({})) as Record<
				string,
				unknown
			>;
			const member = entity && membersOf(entity).config[slot];
			const of = member && resolveMember(member);
			const list =
				of?.["~kind"] === "list" ||
				(of?.["~kind"] === "optional" &&
					resolveMember(of["~of"])["~kind"] === "list");
			if (list) {
				const items = valueAt(config, slot, () => []) as TreeNode[];
				items.push(child);
			} else {
				const items = valueAt(config, slot, () => ({})) as Record<
					string,
					TreeNode
				>;
				if (name in items) {
					throw new Error(`thence: "${name}" is already placed in "${slot}"`);
				}
				items[name] = child;
			}
			return placed(
				child,
				typeof child.type === "string" ? child.type : undefined,
			);
		};
		return {
			add: (
				slot: string,
				name: string,
				placement: TreeNode,
				opts?: { meta?: unknown },
			) =>
				add(slot, name, {
					...placement,
					// A copy, since children added later go into it.
					...(placement.config ? { config: { ...placement.config } } : {}),
					...(opts?.meta === undefined ? {} : { meta: opts.meta }),
				}),
			use: (
				slot: string,
				name: string,
				component: string,
				params?: Record<string, unknown>,
			) =>
				add(slot, name, {
					use: component,
					...(params === undefined ? {} : { params }),
				}),
		};
	};
	build({
		root: placed(tree, undefined),
		define: (name, f) => {
			const functions = valueAt(tree, "functions", () => ({})) as Record<
				string,
				unknown
			>;
			functions[name] = f;
		},
		component: (name, c) => {
			const components = valueAt(tree, "components", () => ({})) as Record<
				string,
				unknown
			>;
			components[name] = c;
		},
	});
	return tree;
}

/** The object's value at `key`, made first if it has none. */
function valueAt(
	object: Record<string, unknown>,
	key: string,
	make: () => object,
): unknown {
	if (object[key] === undefined) object[key] = make();
	return object[key];
}
