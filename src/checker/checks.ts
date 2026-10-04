import type { StandardSchemaV1 } from "../kit";
import type { Check, CheckIssue } from "../plan";

/** The schemas on a type as one {@link Check}; `undefined` when it has none. */
export function checkOf(
	schemas: readonly StandardSchemaV1[],
): Check | undefined {
	if (schemas.length === 0) return undefined;
	return (value) => schemas.flatMap((schema) => validate(schema, value));
}

/**
 * Runs one schema. Only its verdict counts: thence ignores the value it
 * gives back, so a transform never changes what the Operator entered.
 */
export function validate(
	schema: StandardSchemaV1,
	value: unknown,
): readonly CheckIssue[] {
	const r = schema["~standard"].validate(value);
	if (r instanceof Promise) {
		// The verdict would come too late to be the same on every process.
		r.catch(() => {});
		return [
			{
				message: "check.async: a check must give its verdict synchronously",
				path: [],
			},
		];
	}
	return (r.issues ?? []).map(({ message, path = [] }) => ({
		message,
		path: path.map((p) => {
			const key = typeof p === "object" ? p.key : p;
			return typeof key === "number" ? key : String(key);
		}),
	}));
}
