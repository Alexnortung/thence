/**
 * log: the Operators' ops. It validates ops against the plan, orders them by
 * clock (later set wins, removal wins), and reports which inputs changed. It
 * never imports the engine, so it is tested with ops in and changes out.
 *
 * Only the op type so far.
 *
 * @module
 */

import type { Json, Path } from "../values";

export type Op =
	| { t: "set"; at: Path; v: Json; clock?: string }
	| { t: "clear"; at: Path; clock?: string }
	| {
			t: "add";
			at: Path;
			id?: string;
			key?: string;
			order: string;
			clock?: string;
	  }
	| { t: "move"; at: Path; order: string; clock?: string }
	| { t: "remove"; at: Path; clock?: string };
