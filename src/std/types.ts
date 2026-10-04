import type { KitFn } from "../kit";

/** The std functions every kit has by default, by name. */
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
}
