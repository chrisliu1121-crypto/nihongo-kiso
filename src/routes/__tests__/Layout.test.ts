import { describe, expect, it } from "vitest";
import { isKanaQuizRoute } from "../Layout";

// Layout's desktop <aside> branches on this function alone (swap the
// always-on <KanaTable/> for the "打開會記錄為偷看" collapsed card, build
// task 2026-09 "五十音練習"). Unit-testing it directly avoids needing
// jsdom + react-router's MemoryRouter just to exercise a route-string
// comparison (vitest's default environment is "node", DESIGN.md §4).
describe("isKanaQuizRoute", () => {
  it("matches exactly /practice/kana", () => {
    expect(isKanaQuizRoute("/practice/kana")).toBe(true);
  });

  it("does not match other routes", () => {
    expect(isKanaQuizRoute("/")).toBe(false);
    expect(isKanaQuizRoute("/practice/arrange")).toBe(false);
    expect(isKanaQuizRoute("/practice/particle")).toBe(false);
    expect(isKanaQuizRoute("/practice/kana/")).toBe(false);
    expect(isKanaQuizRoute("/practice/kana/extra")).toBe(false);
  });
});
