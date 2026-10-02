/**
 * checker: turns a kit and a Builder's tree into a plan and diagnostics. It
 * resolves scope and types, expands Builder functions and components, lays
 * rows over templates, works out writability and cycles, and compiles
 * closures. The runtime does no analysis.
 *
 * Only the diagnostic type so far. \`check(kit, tree)\` gets its interface in
 * its own PR, together with the plan.
 *
 * @module
 */

import type { Path } from "../values";

export interface Diagnostic {
	code: string;
	message: string;
	at: Path;
	field?: string;
	exprPath?: readonly number[];
	meta?: unknown;
	data?: unknown;
}
