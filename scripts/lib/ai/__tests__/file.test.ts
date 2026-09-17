// scripts/lib/ai/__tests__/file.test.ts — 2026-09-17 "卡死" fix (DESIGN.md
// §9.1a): FileEnricher/FileJudge fixture entries can now be an ARRAY,
// consumed one element per call ("attempt 1 bad, attempt 2 good"), while
// staying fully backward compatible with a plain (non-array) entry. The
// integration-level version of this (used through runGenerationPipeline's
// actual retry loop) lives in
// scripts/__tests__/generate-daily-retry-pipeline.test.ts; this file tests
// FileEnricher/FileJudge directly and in isolation.

import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EnrichResult } from "../enricher";
import type { JudgeResult } from "../judge";
import { FileEnricher, FileJudge } from "../file";
import { AiProviderError } from "../errors";

function writeFixture(entries: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "nk-file-test-"));
  const path = join(dir, "fixture.json");
  writeFileSync(path, JSON.stringify(entries), "utf8");
  return path;
}

const REQ = { surface: "一", reading: "いち", gloss: "一", pos: "名詞" as const, level: "N5", existing_surfaces: [] };
const JUDGE_REQ = { surface: "一", reading: "いち", gloss: "一", example: { ja: "一です。", zh: "是一。", tokens: [] }, existing_examples: [] };

describe("FileEnricher -- plain (non-array) entry stays exactly as before", () => {
  it("returns the same result on every call", async () => {
    const result: EnrichResult = { example: { ja: "一です。", zh: "是一。", tokens: [] }, collocations: [], note: null };
    const enricher = FileEnricher(writeFixture({ "一|いち": result }));
    expect(await enricher.enrich(REQ)).toEqual(result);
    expect(await enricher.enrich(REQ)).toEqual(result);
  });
});

describe("FileEnricher -- array entry: consumed one per call, last element repeats after exhausted", () => {
  it("call 1 gets element 0, call 2 gets element 1, call 3+ keeps getting the last element", async () => {
    const results: EnrichResult[] = [
      { example: { ja: "一です。（壞）", zh: "壞", tokens: [] }, collocations: [], note: "attempt1" },
      { example: { ja: "一です。（好）", zh: "好", tokens: [] }, collocations: [], note: "attempt2" },
    ];
    const enricher = FileEnricher(writeFixture({ "一|いち": results }));
    expect((await enricher.enrich(REQ)).note).toBe("attempt1");
    expect((await enricher.enrich(REQ)).note).toBe("attempt2");
    expect((await enricher.enrich(REQ)).note).toBe("attempt2"); // 3rd call: array exhausted, keeps returning the last
    expect((await enricher.enrich(REQ)).note).toBe("attempt2"); // 4th call: still the last
  });

  it("call counts are tracked independently per word key", async () => {
    const table = {
      "一|いち": [{ example: { ja: "a", zh: "a", tokens: [] }, collocations: [], note: "一-1" }, { example: { ja: "b", zh: "b", tokens: [] }, collocations: [], note: "一-2" }],
      "二|に": [{ example: { ja: "c", zh: "c", tokens: [] }, collocations: [], note: "二-1" }],
    };
    const enricher = FileEnricher(writeFixture(table));
    expect((await enricher.enrich(REQ)).note).toBe("一-1");
    expect((await enricher.enrich({ ...REQ, surface: "二", reading: "に" })).note).toBe("二-1");
    expect((await enricher.enrich(REQ)).note).toBe("一-2"); // "一" call count unaffected by the "二" call in between
  });

  it("a word missing from the fixture still throws AiProviderError, same as before", async () => {
    const enricher = FileEnricher(writeFixture({}));
    await expect(enricher.enrich(REQ)).rejects.toBeInstanceOf(AiProviderError);
  });
});

describe("FileJudge -- same array/plain contract as FileEnricher", () => {
  it("plain entry: same result every call", async () => {
    const result: JudgeResult = { natural: true, reading_ok: true, gloss_ok: true, issues: [] };
    const judge = FileJudge(writeFixture({ "一|いち": result }));
    expect(await judge.judge(JUDGE_REQ)).toEqual(result);
    expect(await judge.judge(JUDGE_REQ)).toEqual(result);
  });

  it("array entry: first call rejects, second call passes (the exact 'judge退回後重試' shape this fix exists for)", async () => {
    const results: JudgeResult[] = [
      { natural: false, reading_ok: true, gloss_ok: true, issues: ["不自然"] },
      { natural: true, reading_ok: true, gloss_ok: true, issues: [] },
    ];
    const judge = FileJudge(writeFixture({ "一|いち": results }));
    expect((await judge.judge(JUDGE_REQ)).natural).toBe(false);
    expect((await judge.judge(JUDGE_REQ)).natural).toBe(true);
  });
});
