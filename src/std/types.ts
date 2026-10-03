import type { KitFn } from "../kit";

/** The std functions, as a value to spread into `kit({ functions })`. */
export interface Std {
	readonly add: KitFn;
	readonly sub: KitFn;
	readonly mul: KitFn;
	readonly div: KitFn;
	readonly sum: KitFn;
	readonly sumValid: KitFn;
	readonly count: KitFn;
	readonly min: KitFn;
	readonly max: KitFn;
	readonly any: KitFn;
	readonly all: KitFn;
	readonly entry: KitFn;
	readonly merge: KitFn;
}
