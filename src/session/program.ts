import type { Diagnostic } from "../checker";
import type { AnyKit, NodeOf } from "../kit";
import type { Op } from "../log";
import type { Path } from "../values";
import type { Session } from "./session";

export interface Program<K extends AnyKit> {
	readonly diagnostics: readonly Diagnostic[];
	run(ops?: readonly Op[]): Session<K>;
	parts(): Iterable<NodeOf<K> & { path: Path }>;
	dependencies(path: Path): { reads: Path[]; readBy: Path[] };
}
