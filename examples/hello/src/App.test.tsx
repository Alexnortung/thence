import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { App } from "./App";

it("adds the two numbers as the Operator types", async () => {
	const screen = await render(<App />);
	await expect.element(screen.getByLabelText("total")).toHaveTextContent("3");
	await screen.getByLabelText("a").fill("40");
	await expect.element(screen.getByLabelText("total")).toHaveTextContent("42");
});
