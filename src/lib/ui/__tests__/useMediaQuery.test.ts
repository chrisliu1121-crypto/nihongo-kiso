import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { useMediaQuery } from "../useMediaQuery";

// vitest's default test environment is "node" (DESIGN.md §4: no jsdom
// installed) -- `window` genuinely doesn't exist here, so this exercises
// the hook's real no-window fallback rather than a mock.
function Probe() {
  const matches = useMediaQuery("(min-width: 1024px)");
  return createElement("span", null, matches ? "yes" : "no");
}

describe("useMediaQuery", () => {
  it("無 window 時回 false（node 環境）", () => {
    expect(typeof window).toBe("undefined");
    const html = renderToStaticMarkup(createElement(Probe));
    expect(html).toBe("<span>no</span>");
  });
});
