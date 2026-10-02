import { describe, expect, it } from "vitest";
import { e, kit, t } from ".";

describe("shells", () => {
	it("throw until their module is implemented", () => {
		expect(() => kit({} as never)).toThrow("thence: kit isn't implemented yet");
		expect(() => t.int).toThrow("thence: t isn't implemented yet");
		expect(() => e.self("qty")).toThrow("thence: e isn't implemented yet");
	});
});
