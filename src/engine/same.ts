import { Decimal, type Result } from "../values";

/** Whether two results hold the same value, so subscribers needn't hear about it. */
export function same(a: Result<unknown>, b: Result<unknown>): boolean {
	if (a.ok !== b.ok) return false;
	if (!a.ok || !b.ok) {
		return (
			!a.ok &&
			!b.ok &&
			a.error.code === b.error.code &&
			key(a.error.at) === key(b.error.at)
		);
	}
	if (a.value instanceof Decimal && b.value instanceof Decimal) {
		return a.value.equals(b.value) && a.value.scale === b.value.scale;
	}
	if (typeof a.value === "object" && a.value !== null) {
		return JSON.stringify(a.value) === JSON.stringify(b.value);
	}
	return Object.is(a.value, b.value);
}

function key(at: readonly unknown[]): string {
	return JSON.stringify(at);
}
