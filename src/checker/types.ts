import type { Plan } from "../plan";
import type { Path } from "../values";

/** A mistake in a kit or a Builder's program, found before anything runs. */
export interface Diagnostic {
	code: string;
	/** A warning doesn't break anything, such as an own member hiding a sibling; anything else is an error. */
	severity?: "warning";
	message: string;
	at: Path;
	field?: string;
	exprPath?: readonly number[];
	meta?: unknown;
	data?: unknown;
	/** For a mistake inside a component's body, or in its definition: the component. */
	component?: string;
}

/** What checking gives: a plan that always runs, and what is wrong with it. */
export interface Checked {
	readonly plan: Plan;
	readonly diagnostics: readonly Diagnostic[];
	/** Every node the Builder placed that fits the kit, in the order of the tree, with its path. */
	readonly parts: readonly Part[];
}

/** A node the Builder placed, as written, and where: config keys and list positions from the root. */
export interface Part {
	readonly path: Path;
	readonly node: Readonly<Record<string, unknown>>;
}
