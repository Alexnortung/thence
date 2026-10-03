// What the bundle exposes to run.mjs, in Node and in each browser.
import { engine, runHarness } from "./corpus";

(globalThis as Record<string, unknown>).thenceHarness = { engine, runHarness };
