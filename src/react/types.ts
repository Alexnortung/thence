import type { Result } from "../values";

/** What `useValue` needs from a member handle: any `Member`, `InputMember` or trait-typed input. */
export interface Readable<T> {
	get(): Result<T>;
	subscribe(listener: () => void): () => void;
}
/** What `useEntries` needs from a list or map handle. */
export interface Collection<K extends string, H> {
	entries(): [K, H][];
	subscribe(listener: () => void): () => void;
}
