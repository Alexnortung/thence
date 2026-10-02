/**
 * Where an instance lives in a running program, from the root: map keys,
 * list positions, and `{ id }` for a list element the Builder placed.
 * `session.at(error.at)` finds the instance an error is about.
 */
export type Path = readonly (string | number | { readonly id: string })[];

/**
 * A failure, as a value. Anything that fails where a session can see it
 * reports it this way rather than by throwing, so an error flows to the
 * values that depend on it and everything else carries on.
 */
export type ThenceError = {
	/** Stable and machine-readable, like `div.zero` or `codec.invalid`. */
	readonly code: string;
	readonly at: Path;
	/** For people. It may change between versions; match on `code`. */
	readonly message: string;
	/** The error this one was caused by, when a value failed because a value it reads failed. */
	readonly cause?: ThenceError;
};

/** What `member.get()` returns, and what any step that can fail returns. */
export type Result<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: ThenceError };

/** A successful result. */
export function ok<T>(value: T): Result<T> {
	return { ok: true, value };
}

/** A failed result. */
export function fail(
	code: string,
	message: string,
	at: Path = [],
): Result<never> {
	return { ok: false, error: { code, message, at } };
}

/**
 * Thrown by a function's `impl` to fail with its own code, such as
 * `div.zero`. The call's value becomes that error; anything else an `impl`
 * throws becomes `fn.threw`.
 */
export class FnError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = "FnError";
	}
}
