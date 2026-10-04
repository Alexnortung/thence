// The functions that build your data document: `entry` and `merge`. `record`
// takes named fields, so the checker compiles it itself.

import { type Aggregate, fn, type KitFn, t } from "../kit";
import { toJson } from "../plan";
import { FnError, type Json } from "../values";

/**
 * `entry(key, x)`: an object with one key that is computed, such as a
 * field's key in its map. Without a key, as outside a map, it is `null`,
 * which `merge` skips.
 */
export const entry: KitFn = fn("entry", {
	params: [{ key: t.text.nullable() }, { x: t.json }],
	returns: t.json,
	impl: ({ key, x }) => (key === null ? null : { [key]: toJson(x) }),
});

/** What `merge` has seen: the keys so far, and the first one that came twice. */
interface Merged {
	readonly out: Record<string, Json>;
	twice?: string;
	notObject?: boolean;
}

/**
 * `merge(a, b, …)` or `merge(list)`: one object with the keys of all of them,
 * in order. `null` adds nothing; the same key twice is an error naming it.
 */
const merging: Aggregate<Merged, unknown, Json> = {
	"~kind": "aggregate",
	init: () => ({ out: {} }),
	add: (acc, v) => {
		const json = toJson(v);
		if (json === null) return acc;
		if (typeof json !== "object" || Array.isArray(json)) {
			acc.notObject = true;
			return acc;
		}
		for (const [k, x] of Object.entries(json)) {
			if (k in acc.out) acc.twice ??= k;
			else acc.out[k] = x;
		}
		return acc;
	},
	result: (acc) => {
		if (acc.notObject) {
			throw new FnError("merge.notObject", "merge takes objects");
		}
		if (acc.twice !== undefined) {
			throw new FnError(
				"merge.duplicate",
				`"${acc.twice}" is in more than one of the merged objects`,
			);
		}
		return acc.out;
	},
};
export const merge: KitFn = fn("merge", {
	params: [{ xs: t.list(t.json) }],
	returns: t.json,
	aggregate: merging,
});
