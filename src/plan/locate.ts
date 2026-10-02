import type { Address, Located, Plan } from "./types";

/**
 * Follows an address through the plan's shapes. It doesn't know which
 * elements exist; that is the log's business.
 */
export function locate(plan: Plan, at: Address): Located | undefined {
	let shape = plan.shapes.get(plan.root);
	let i = 0;
	while (shape) {
		if (i === at.length) return { kind: "instance", shape };
		const name = at[i] as string;
		const input = shape.inputs[name];
		const value = shape.values[name];
		if (i === at.length - 1) {
			if (input) return { kind: "input", owner: shape, name, input };
			if (value) return { kind: "value", owner: shape, name, value };
			return undefined;
		}
		if (input?.kind !== "list") return undefined;
		shape = plan.shapes.get(input.of);
		i += 2;
	}
	return undefined;
}
