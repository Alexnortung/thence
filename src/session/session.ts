import type { AnyKit, RootOf } from "../kit";
import type { Op } from "../log";
import type { Json, Path } from "../values";
import type { At, Handle, Member } from "./handles";

export interface Session<K extends AnyKit> {
	readonly root: Handle<RootOf<K>, K>;
	at<const P extends readonly Segment[]>(path: P): At<K, P> | undefined;
	issues(): readonly Issue[];
	apply(op: Op | readonly Op[]): void;
	batch(f: () => void): void;
	onApply(f: (op: Op) => void): () => void;
	ops(): readonly Op[];
	snapshot(): Json;
	explain(m: Member<unknown>): unknown;
}
/** A name, a position, or a row by the id the program gave it. */
export type Segment = string | number | { readonly id: string };
export type Issue = { message: string; path: Path };
