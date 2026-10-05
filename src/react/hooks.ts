import {
	createContext,
	createElement,
	type ReactNode,
	useCallback,
	useContext,
	useRef,
	useSyncExternalStore,
} from "react";
import type { Op } from "../log";
import type { Segment, Session } from "../session";
import { fail, type Result } from "../values";
import type {
	CollectionPath,
	EntriesAt,
	From,
	RegisteredSession,
	ValueAt,
	ValuePath,
	WritableAt,
	WritablePath,
} from "./types";

const SessionContext = createContext<Session<any> | undefined>(undefined);

/** Gives `session` to the hooks below it that take a path alone. */
export function SessionProvider(props: {
	session: Session<any>;
	children?: ReactNode;
}): ReactNode {
	return createElement(
		SessionContext.Provider,
		{ value: props.session },
		props.children,
	);
}

/**
 * The value a path names, or the error that stopped it, re-rendering only
 * when it changes. The path starts at a session's root or at an entity's
 * handle, or, given alone, at the root of the session from
 * `SessionProvider`. It follows positions: `["rows", 0, "qty"]` is the first
 * row's quantity, whichever row is first now. `undefined` when the path
 * takes a row that isn't there.
 */
export function useValue<const P extends readonly Segment[]>(
	path: P & ValuePath<RegisteredSession, P>,
): ValueAt<RegisteredSession, P>;
export function useValue<F extends From, const P extends readonly Segment[]>(
	from: F,
	path: P & ValuePath<F, P>,
): ValueAt<F, P>;
export function useValue(
	...args: [Path] | [From, Path]
): Result<unknown> | undefined {
	const [entity, path] = useFrom(args);
	return useAt(entity, path, readValue);
}

/**
 * Like {@link useValue}, with a setter, as `useState` gives: for a path that
 * names an input or a writable derived value. The setter sets whatever the
 * path names when it is called.
 */
export function useWritable<const P extends readonly Segment[]>(
	path: P & WritablePath<RegisteredSession, P>,
): WritableAt<RegisteredSession, P>;
export function useWritable<F extends From, const P extends readonly Segment[]>(
	from: F,
	path: P & WritablePath<F, P>,
): WritableAt<F, P>;
export function useWritable(
	...args: [Path] | [From, Path]
): [Result<unknown> | undefined, (v: unknown) => Result<Op>] {
	const [entity, path] = useFrom(args);
	const value = useAt(entity, path, readValue);
	const key = JSON.stringify(path);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `path`, a new array each render
	const set = useCallback(
		(v: unknown): Result<Op> => {
			const target = entity.at(path) as Settable | undefined;
			return target && "set" in target
				? target.set(v)
				: fail("write.readonly", "nothing here can be set", []);
		},
		[entity, key],
	);
	return [value, set];
}

/**
 * The rows of the list or the entries of the map a path names, in order,
 * re-rendering when one is added, removed or moved. The array stays the
 * same while they do, so components that take it can skip rendering. A
 * change to a value inside a row doesn't re-render here: read it with
 * `useValue` where it is shown. Empty when the path takes a row that isn't
 * there.
 */
export function useEntries<const P extends readonly Segment[]>(
	path: P & CollectionPath<RegisteredSession, P>,
): EntriesAt<RegisteredSession, P>;
export function useEntries<F extends From, const P extends readonly Segment[]>(
	from: F,
	path: P & CollectionPath<F, P>,
): EntriesAt<F, P>;
export function useEntries(
	...args: [Path] | [From, Path]
): [string, unknown][] {
	const [entity, path] = useFrom(args);
	const last = useRef<[string, unknown][]>([]);
	return useAt(entity, path, (target) => {
		const now = (target as Entries | undefined)?.entries() ?? [];
		const before = last.current;
		// Handles are cached by the session, so the same row gives the same handle.
		if (
			before.length === now.length &&
			now.every(([k, h], i) => before[i]?.[0] === k && before[i]?.[1] === h)
		) {
			return before;
		}
		last.current = now;
		return now;
	});
}

type Path = readonly Segment[];
/** What a path starts from: an entity's handle, or a session's root. */
type Start = {
	at(path: Path): unknown;
	subscribe(path: Path, listener: () => void): () => void;
};
type Settable = { set(v: unknown): Result<Op> };
type Entries = { entries(): [string, unknown][] };

/** The entity a hook's path starts from, and the path. */
function useFrom(args: [Path] | [From, Path]): [Start, Path] {
	const given = useContext(SessionContext);
	const [from, path] = args.length === 1 ? [given, args[0]] : args;
	if (!from) {
		throw new Error(
			"thence: a hook given a path alone needs a SessionProvider above it",
		);
	}
	return ["root" in from ? (from.root as Start) : (from as Start), path];
}

/**
 * `read` of what `path` names from `entity`, re-reading when that changes.
 * `read` must give the same object while nothing changed.
 */
function useAt<T>(entity: Start, path: Path, read: (target: unknown) => T): T {
	const key = JSON.stringify(path);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `path`, a new array each render
	const subscribe = useCallback(
		(listener: () => void) => entity.subscribe(path, listener),
		[entity, key],
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: as above, and `read` is the caller's
	const get = useCallback(() => read(entity.at(path)), [entity, key]);
	return useSyncExternalStore(subscribe, get, get);
}

/** A member's value; `get()` gives the same object until it changes. */
function readValue(target: unknown): Result<unknown> | undefined {
	return (target as { get?(): Result<unknown> } | undefined)?.get?.();
}
