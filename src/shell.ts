/**
 * A stand-in for a value that has its types but no implementation yet.
 * Calling it, or reading anything from it, throws. Each module replaces its
 * shells with real code; when none are left, this file goes.
 */
export function shell<T>(name: string): T {
	const fail = (): never => {
		throw new Error(`thence: ${name} isn't implemented yet`);
	};
	return new Proxy(fail, { apply: fail, construct: fail, get: fail }) as T;
}
