import type { Plan } from "../plan";
import type { Path } from "../values";

/** A mistake in a kit or a Builder's program, found before anything runs. */
export interface Diagnostic {
	code: string;
	/** A warning doesn't break anything, such as an own member hiding a sibling; anything else is an error. */
	severity?: "warning";
	message: string;
	/** The path of the node the mistake is in. */
	at: Path;
	/** The config field or member, when the mistake is in one. */
	field?: string;
	/** Where in the field's expression: `[2, 1]` is the first argument of the second argument. */
	exprPath?: readonly number[];
	/** The node's `meta`, as the Builder wrote it. */
	meta?: unknown;
	/** The `data` of an `error` expression, as you wrote it. */
	data?: unknown;
}

/** What checking gives: a plan that always runs, and what is wrong with it. */
export interface Checked {
	readonly plan: Plan;
	readonly diagnostics: readonly Diagnostic[];
}
