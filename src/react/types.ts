import type { AnyKit, In, RootOf } from "../kit";
import type { Op } from "../log";
import type {
	AtFrom,
	EntityHandle,
	InputMember,
	ListHandle,
	MapHandle,
	Member,
	Segment,
	Session,
} from "../session";
import type { Result } from "../values";

/**
 * Names the kit of the session `SessionProvider` gives, so a hook called
 * with a path alone is typed too:
 *
 * ```ts
 * declare module "thence/react" {
 *   interface Register {
 *     kit: typeof shop;
 *   }
 * }
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: filled in by the app, as above
export interface Register {}

/**
 * The session `SessionProvider` gives, typed from `Register` when the app
 * filled it in; otherwise any path is accepted and its value is `unknown`.
 */
export type RegisteredSession = Register extends { kit: infer K extends AnyKit }
	? Session<K>
	: Unregistered;
/** No kit in `Register`. */
export interface Unregistered {
	readonly "~unregistered": true;
}

/** Where a hook's path starts: a session, from its root, or an entity's handle. */
export type From = Session<any> | EntityHandle<any, any>;

/**
 * The handle a path from `F` names.
 *
 * @typeParam F - where the path starts
 * @typeParam P - the path's segments
 */
export type Target<F, P extends readonly Segment[]> =
	F extends Session<infer K>
		? AtFrom<RootOf<K>, K, P>
		: F extends EntityHandle<infer E, infer K>
			? AtFrom<E, K, P>
			: never;

/**
 * `undefined` when the path takes a row by position or id, which may not be
 * there.
 *
 * @typeParam P - the path's segments
 */
export type Missing<P extends readonly Segment[]> = P[number] extends string
	? never
	: undefined;

/** Accepts a path only when it names a value. */
export type ValuePath<F, P extends readonly Segment[]> = F extends Unregistered
	? unknown
	: [Target<F, P>] extends [never]
		? "nothing is at this path"
		: [Target<F, P>] extends [Member<unknown>]
			? unknown
			: "this path doesn't name a value";
/** Accepts a path only when it names a value the Operator can set. */
export type WritablePath<
	F,
	P extends readonly Segment[],
> = F extends Unregistered
	? unknown
	: [Target<F, P>] extends [never]
		? "nothing is at this path"
		: [Target<F, P>] extends [InputMember<any>]
			? unknown
			: "this path doesn't name a value that can be set";
/** Accepts a path only when it names a list or a map. */
export type CollectionPath<
	F,
	P extends readonly Segment[],
> = F extends Unregistered
	? unknown
	: [Target<F, P>] extends [never]
		? "nothing is at this path"
		: [Target<F, P>] extends [ListHandle<any, any> | MapHandle<any, any>]
			? unknown
			: "this path doesn't name a list or a map";

/** What `useValue` gives for a path: the value or the error that stopped it. */
export type ValueAt<F, P extends readonly Segment[]> = F extends Unregistered
	? Result<unknown> | undefined
	: Target<F, P> extends Member<infer V>
		? Result<V> | Missing<P>
		: never;

/** What `useWritable` gives for a path: the value, and a setter like `useState`'s. */
export type WritableAt<F, P extends readonly Segment[]> = F extends Unregistered
	? [value: Result<unknown> | undefined, set: (v: unknown) => Result<Op>]
	: Target<F, P> extends InputMember<infer V>
		? [value: Result<V> | Missing<P>, set: (v: In<V>) => Result<Op>]
		: never;

/** What `useEntries` gives for a path: the rows or entries with their handles, in order. */
export type EntriesAt<F, P extends readonly Segment[]> = F extends Unregistered
	? [string, unknown][]
	: Target<F, P> extends { entries(): infer Entries }
		? Entries
		: never;
