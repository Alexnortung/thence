import { useCallback, useRef, useSyncExternalStore } from "react";
import type { Result } from "../values";
import type { Collection, Readable } from "./types";

/**
 * The member's value, or the error that stopped it, re-rendering when it
 * changes. `get()` returns the same object until the value changes, so this
 * is `useSyncExternalStore` over the handle.
 */
export function useValue<T>(member: Readable<T>): Result<T> {
	const subscribe = useCallback(
		(listener: () => void) => member.subscribe(listener),
		[member],
	);
	const get = useCallback(() => member.get(), [member]);
	return useSyncExternalStore(subscribe, get, get);
}

/**
 * A list's rows or a map's entries, in order, re-rendering when one is
 * added, removed or moved. The array stays the same while they do, so
 * components that take it can skip rendering. A change to a value inside a
 * row doesn't re-render here: read it with `useValue` where it is shown.
 */
export function useEntries<K extends string, H>(
	collection: Collection<K, H>,
): [K, H][] {
	const last = useRef<[K, H][] | undefined>(undefined);
	const subscribe = useCallback(
		(listener: () => void) => collection.subscribe(listener),
		[collection],
	);
	const get = useCallback(() => {
		const now = collection.entries();
		const before = last.current;
		// Handles are cached by the session, so the same row gives the same handle.
		if (
			before?.length === now.length &&
			now.every(([k, h], i) => before[i]?.[0] === k && before[i]?.[1] === h)
		) {
			return before;
		}
		last.current = now;
		return now;
	}, [collection]);
	return useSyncExternalStore(subscribe, get, get);
}
