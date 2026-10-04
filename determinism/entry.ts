// What the bundle exposes to run.ts, in Node and in each browser.
import { engine, runHarness } from "./harness";

(globalThis as Record<string, unknown>).thenceHarness = { engine, runHarness };
