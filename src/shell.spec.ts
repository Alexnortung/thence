import { describe, expect, it } from "vitest";
import { has } from ".";

describe("shells", () => {
	it("throw until their module is implemented", () => {
		expect(() => has({} as never, {} as never)).toThrow(
			"thence: has isn't implemented yet",
		);
	});
});
