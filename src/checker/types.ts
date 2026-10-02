import type { Plan } from "../plan";
import type { Path } from "../values";

/** A mistake in a kit or a Builder's program, found before anything runs. */
export interface Diagnostic {
	code: string;
	message: string;
	at: Path;
	field?: string;
	exprPath?: readonly number[];
	meta?: unknown;
	data?: unknown;
}

/** What checking gives: a plan that always runs, and what is wrong with it. */
export interface Checked {
	readonly plan: Plan;
	readonly diagnostics: readonly Diagnostic[];
}
