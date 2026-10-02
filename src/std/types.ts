import type { StdFn } from "../kit";

/** The std functions, as a value to spread into `kit({ functions })`. */
export interface Std {
	readonly add: StdFn;
	readonly sub: StdFn;
	readonly mul: StdFn;
	readonly div: StdFn;
	readonly sum: StdFn;
}
