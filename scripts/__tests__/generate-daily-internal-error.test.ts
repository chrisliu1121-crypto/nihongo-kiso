// scripts/__tests__/generate-daily-internal-error.test.ts — 2026-09-24
// The 09-22 and 09-24 crons both exited 1 with no pending file and no step
// summary: an exception that was NOT an AiProviderError escaped
// runGenerationPipeline's per-word loop (both catch blocks rethrew anything
// else, and assembleSeed/validateWordStandalone sat outside any try), so one
// odd AI response crashed the whole night with nothing saved. These tests pin
// the fix: such errors become that attempt's problem -> retry -> skip/replace,
// and a top-level crash still lands in the public step summary.

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Enricher, EnrichRequest, EnrichResult } from "../lib/ai/enricher";
import type { Judge, JudgeRequest, JudgeResult } from "../lib/ai/judge";
import { StubEnricher, StubJudge } from "../lib/ai/stub";
import { buildKnownKanji } from "../lib/validate-words";
import { runGenerationPipeline, writeCrashSummary, type FrequencyWord } from "../generate-daily";

const WORDS: FrequencyWord[] = [
  { rank: 1, surface: "これ", reading: "これ", gloss: "這個", pos: "代名詞" },
  { rank: 2, surface: "それ", reading: "それ", gloss: "那個", pos: "代名詞" },
  { rank: 3, surface: "あれ", reading: "あれ", gloss: "那個（遠）", pos: "代名詞" },
];

const baseOpts = {
  existingSurfaces: [] as string[],
  existingExamples: [] as string[],
  knownKanji: buildKnownKanji([]),
  existingExampleJa: new Set<string>(),
  date: "2026-12-29",
};

/** Throws `err` for `surface` on the listed (1-based) attempts; otherwise defers to StubEnricher. */
function flakyEnricher(surface: string, badAttempts: number[], err: () => unknown): Enricher {
  let n = 0;
  return {
    name: "flaky",
    async enrich(req: EnrichRequest): Promise<EnrichResult> {
      if (req.surface === surface) {
        n++;
        if (badAttempts.includes(n)) throw err();
      }
      return StubEnricher.enrich(req);
    },
  };
}

describe("runGenerationPipeline: non-provider exceptions never crash the run", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a plain TypeError from enrich on attempt 1 is recorded and the word is accepted on attempt 2", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runGenerationPipeline({
      ...baseOpts,
      candidates: [WORDS[0]],
      enricher: flakyEnricher("これ", [1], () => new TypeError("Cannot read properties of undefined (reading 'tokens')")),
      judge: StubJudge,
      wordsPerDay: 1,
    });
    expect(result.aborted).toBeUndefined();
    expect(result.accepted.map((a) => a.freqWord.surface)).toEqual(["これ"]);
    const attempts = result.attempts["これ|これ"];
    expect(attempts).toHaveLength(1);
    expect(attempts[0].stage).toBe("enrich");
    expect(attempts[0].problems[0]).toContain("內部錯誤（enrich，TypeError）");
  });

  it("an enricher that always throws a plain Error is skipped and replaced; the run still completes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runGenerationPipeline({
      ...baseOpts,
      candidates: WORDS,
      enricher: flakyEnricher("これ", [1, 2, 3], () => new Error("boom")),
      judge: StubJudge,
      wordsPerDay: 2,
    });
    expect(result.aborted).toBeUndefined();
    expect(result.skipped.map((s) => s.surface)).toEqual(["これ"]);
    expect(result.accepted.map((a) => a.freqWord.surface)).toEqual(["それ", "あれ"]);
  });

  it("a malformed enrich result is a 'validate' problem on that attempt, never a crash", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let n = 0;
    const malformed: Enricher = {
      name: "malformed",
      async enrich(req: EnrichRequest): Promise<EnrichResult> {
        n++;
        if (n === 1) return { example: { ja: "x", zh: "x", tokens: null }, collocations: [], note: null } as unknown as EnrichResult;
        return StubEnricher.enrich(req);
      },
    };
    const result = await runGenerationPipeline({ ...baseOpts, candidates: [WORDS[0]], enricher: malformed, judge: StubJudge, wordsPerDay: 1 });
    expect(result.accepted).toHaveLength(1);
    // tokens:null is caught by validateWordStandalone's zod pass as an ordinary
    // schema problem; anything that slips past zod and throws lands in the
    // internalProblem("validate") catch instead. Either way: recorded, retried.
    expect(result.attempts["これ|これ"][0].stage).toBe("validate");
    expect(result.attempts["これ|これ"][0].problems.length).toBeGreaterThan(0);
  });

  it("a plain Error from judge is recorded as a 'judge' problem and retried", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let n = 0;
    const flakyJudge: Judge = {
      name: "flaky-judge",
      async judge(req: JudgeRequest): Promise<JudgeResult> {
        n++;
        if (n === 1) throw new RangeError("weird judge output");
        return StubJudge.judge(req);
      },
    };
    const result = await runGenerationPipeline({ ...baseOpts, candidates: [WORDS[0]], enricher: StubEnricher, judge: flakyJudge, wordsPerDay: 1 });
    expect(result.accepted).toHaveLength(1);
    expect(result.attempts["これ|これ"][0].stage).toBe("judge");
    expect(result.attempts["これ|これ"][0].problems[0]).toContain("內部錯誤（judge，RangeError）");
  });
});

describe("writeCrashSummary", () => {
  const saved = { summary: process.env.GITHUB_STEP_SUMMARY, key: process.env.OPENROUTER_API_KEY };
  afterEach(() => {
    process.env.GITHUB_STEP_SUMMARY = saved.summary;
    process.env.OPENROUTER_API_KEY = saved.key;
    if (saved.summary === undefined) delete process.env.GITHUB_STEP_SUMMARY;
    if (saved.key === undefined) delete process.env.OPENROUTER_API_KEY;
  });

  it("appends the error and stack to $GITHUB_STEP_SUMMARY with the API key redacted", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "nk-crash-")), "summary.md");
    writeFileSync(path, "", "utf8");
    process.env.GITHUB_STEP_SUMMARY = path;
    process.env.OPENROUTER_API_KEY = "sk-or-CANARY-123";
    await writeCrashSummary(new Error("upstream said: Bearer sk-or-CANARY-123 rejected"));
    const out = readFileSync(path, "utf8");
    expect(out).toContain("## generate-daily 崩潰");
    expect(out).toContain("upstream said: Bearer [REDACTED] rejected");
    expect(out).not.toContain("sk-or-CANARY-123");
  });

  it("is a no-op off CI (no GITHUB_STEP_SUMMARY)", async () => {
    delete process.env.GITHUB_STEP_SUMMARY;
    await expect(writeCrashSummary(new Error("x"))).resolves.toBeUndefined();
  });
});
