import { engine, runHarness } from "./corpus.js";

(globalThis as Record<string, unknown>).thenceHarness = { runHarness, engine };
