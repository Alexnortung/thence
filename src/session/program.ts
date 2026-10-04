import type { Diagnostic } from "../checker";
import type { AnyKit, PlacementOf } from "../kit";
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
	run(ops?: readonly Op[], options?: RunOptions): Session<K>;
	/** Every entity the Builder placed, as placed, with its path, for the Builder UI. */
	parts(): Iterable<PlacementOf<K> & { path: Path }>;
	/** The members the member at `path` reads. */
	dependencies(path: Path): readonly Path[];
	/** The members that read the member at `path`. */
	dependents(path: Path): readonly Path[];
}

/** How a session is started. */
export interface RunOptions {
	/**
	 * This process's id among the Operators of one session: the first part of
	 * every clock and element id it makes. Random when left out. It can't
	 * contain ":".
	 */
	readonly replica?: string;
}
