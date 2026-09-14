// scripts/lib/ai/__tests__/no-sdk-on-stub-path.test.ts — build task 2026-09
// step 6: "寫一個「不帶 --enricher claude 時 @anthropic-ai/sdk 不會被
// import」的測試". This machine has no ANTHROPIC_API_KEY, and the whole
// pipeline must run with the stub backend without ever touching the
// network SDK.
//
// The actual runtime guarantee this proves is a STATIC one: generate-daily.ts
// and cross-check.ts never `import` scripts/lib/ai/claude.ts at their top
// level -- they only reach it through a dynamic `import("./lib/ai/claude.ts")`
// inside resolveEnricher/resolveJudge, gated on the CLI spec actually being
// "claude" (see generate-daily.test.ts's "claude is loaded ONLY when
// requested" tests for the runtime half of this: a thrown loader proves
// resolveEnricher("stub"/"file:...", ...) never calls it). Given that
// structure, ordinary ES module semantics mean @anthropic-ai/sdk is
// physically unreachable unless resolveEnricher/resolveJudge is called with
// "claude" -- so checking the import graph by source text is a direct,
// sufficient proof, and avoids the flakiness of trying to intercept Vite's
// SSR module loader for a dynamic `import()` from a test.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

function importsSdk(source: string): boolean {
  return /from\s+["']@anthropic-ai\/sdk["']/.test(source) || /import\s*\(\s*["']@anthropic-ai\/sdk["']/.test(source);
}

describe("@anthropic-ai/sdk is only reachable through claude.ts", () => {
  it("scripts/lib/ai/claude.ts DOES statically import the SDK (sanity check that importsSdk() actually detects it)", () => {
    const source = readFileSync(new URL("../claude.ts", import.meta.url), "utf8");
    expect(importsSdk(source)).toBe(true);
  });

  it("scripts/lib/ai/stub.ts never imports the SDK", () => {
    const source = readFileSync(new URL("../stub.ts", import.meta.url), "utf8");
    expect(importsSdk(source)).toBe(false);
  });

  it("scripts/lib/ai/file.ts never imports the SDK", () => {
    const source = readFileSync(new URL("../file.ts", import.meta.url), "utf8");
    expect(importsSdk(source)).toBe(false);
  });

  it("scripts/lib/ai/enricher.ts / judge.ts (the shared interfaces) never import the SDK", () => {
    for (const file of ["../enricher.ts", "../judge.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(importsSdk(source)).toBe(false);
    }
  });

  it("generate-daily.ts never statically imports claude.ts -- only a gated dynamic import inside resolveEnricher/resolveJudge reaches it", () => {
    const source = readFileSync(new URL("../../../generate-daily.ts", import.meta.url), "utf8");
    // A static import would be `import ... from "./lib/ai/claude.ts"` at
    // top level; the only mention of claude.ts allowed is inside the
    // dynamic `import("./lib/ai/claude.ts")` call.
    const staticImportRe = /^\s*import\s+.*from\s+["'][^"']*ai\/claude\.ts["']/m;
    expect(staticImportRe.test(source), "generate-daily.ts statically imports claude.ts").toBe(false);
    expect(source.includes('import("./lib/ai/claude.ts")')).toBe(true);
    expect(importsSdk(source)).toBe(false);
  });

  it("cross-check.ts never imports claude.ts or the SDK at all -- it only reaches resolveJudge from generate-daily.ts, which owns the gated dynamic import", () => {
    const source = readFileSync(new URL("../../../cross-check.ts", import.meta.url), "utf8");
    expect(source.includes("ai/claude.ts")).toBe(false);
    expect(importsSdk(source)).toBe(false);
  });
});

// scripts/lib/ai/openrouter.ts is pure `fetch` (no SDK at all), but it's
// still gated behind a dynamic import in generate-daily.ts for the same
// isolation reason claude.ts is -- see openrouter.ts's own header comment.
// This block extends the guarantees above to cover it.
describe("openrouter.ts is pure fetch, and only reachable through a gated dynamic import", () => {
  it("scripts/lib/ai/openrouter.ts never imports the SDK", () => {
    const source = readFileSync(new URL("../openrouter.ts", import.meta.url), "utf8");
    expect(importsSdk(source)).toBe(false);
  });

  it("scripts/lib/ai/openrouter.ts never imports anything from claude.ts (would drag the SDK in transitively)", () => {
    const source = readFileSync(new URL("../openrouter.ts", import.meta.url), "utf8");
    expect(/from\s+["'][^"']*\bclaude\.ts["']/.test(source)).toBe(false);
  });

  it("generate-daily.ts never statically imports openrouter.ts -- only a gated dynamic import inside resolveEnricher/resolveJudge reaches it", () => {
    const source = readFileSync(new URL("../../../generate-daily.ts", import.meta.url), "utf8");
    const staticImportRe = /^\s*import\s+.*from\s+["'][^"']*ai\/openrouter\.ts["']/m;
    expect(staticImportRe.test(source), "generate-daily.ts statically imports openrouter.ts").toBe(false);
    expect(source.includes('import("./lib/ai/openrouter.ts")')).toBe(true);
  });

  it("cross-check.ts never mentions ai/openrouter.ts at all -- it only reaches resolveJudge from generate-daily.ts, which owns the gated dynamic import", () => {
    const source = readFileSync(new URL("../../../cross-check.ts", import.meta.url), "utf8");
    expect(source.includes("ai/openrouter.ts")).toBe(false);
  });
});
