import type { Diagnostic } from "../checker";
import type { AnyKit, NodeOf } from "../kit";
import type { Op } from "../log";
import type { Path } from "../values";
import type { Session } from "./session";

/**
 * A checked program, made by `kit.program(tree)`.
 *
 * @typeParam K - the kit it was built with
 */
export interface Program<K extends AnyKit> {
	/** What the checker found. A program with errors still runs: every member that reads a broken field holds the error. */
	readonly diagnostics: readonly Diagnostic[];
	/** Starts a session, replaying saved ops. */
	run(ops?: readonly Op[]): Session<K>;
	/** Every placed node with its path, for the Builder UI. */
	parts(): Iterable<NodeOf<K> & { path: Path }>;
	/** What the member at `path` reads, and what reads it. */
	dependencies(path: Path): { reads: Path[]; readBy: Path[] };
}
