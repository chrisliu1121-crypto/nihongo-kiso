// scripts/__tests__/generate-daily-partial-enrich-failure.test.ts — code
// review item 1 (P0), required test: a mid-batch enrich() failure must not
// lose the whole batch (previously: a provider's process.exit(2) killed the
// process before writePending() was ever called, so a failure left nothing
// on disk for a human to review).
//
// This test proves the fix fully offline, using FileEnricher's existing
// "throws if a requested word isn't in its backing JSON file" behavior
// (scripts/lib/ai/file.ts) as an offline AiProviderError simulation -- no
// fetch mocking needed. FileEnricher/FileJudge were changed (this same
// review) to throw AiProviderError instead of a plain Error specifically so
// this "missing fixture entry" failure is caught the same way a real
// openrouter.ts/claude.ts per-word failure is.
//
// It exercises generate-daily.ts's core enrich-phase logic
// (enrichCandidates) directly with a 3-word batch, rather than going
// through the CLI/main(): WORDS_PER_DAY is a fixed constant (10, review
// item 6 removed the --count flag), so main() itself can't be asked for a
// 3-word batch. enrichCandidates/writePending/printErrorSummary are the
// exact same exported building blocks main() itself calls.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EnrichResult } from "../lib/ai/enricher";
import { FileEnricher } from "../lib/ai/file";
import { AiProviderError } from "../lib/ai/errors";
import { pendingPath, type PendingDayFile, type PipelineMeta } from "../lib/pending";
import {
  canPromote,
  enrichCandidates,
  printErrorSummary,
  writePending,
  type FrequencyWord,
} from "../generate-daily";

// A date that will never collide with a real generated day -- written to
// (and cleaned up from) the repo's real data/pending/ directory, since
// pendingPath()/writePending() aren't overridable to a temp directory.
const TEST_DATE = "1999-01-01";

const CANDIDATES: FrequencyWord[] = [
  { rank: 1, surface: "私", reading: "わたし", gloss: "我", pos: "代名詞" },
  { rank: 2, surface: "人", reading: "ひと", gloss: "人", pos: "名詞" },
  // Deliberately NOT in the fixture below -- FileEnricher.enrich() throws
  // AiProviderError for it, simulating a real provider's per-word failure.
  { rank: 3, surface: "今日", reading: "きょう", gloss: "今天", pos: "名詞" },
];
const IDS = ["w_9901", "w_9902", "w_9903"];

function writeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nk-test-"));
  const path = join(dir, "fixture.json");
  const entries: Record<string, EnrichResult> = {
    "私|わたし": {
      example: { ja: "私です。", zh: "我。", tokens: [{ surface: "私", reading: "わたし", gloss: "我" }, { surface: "です", reading: "です", gloss: "是" }] },
      collocations: [],
      note: null,
    },
    "人|ひと": {
      example: { ja: "人です。", zh: "人。", tokens: [{ surface: "人", reading: "ひと", gloss: "人" }, { surface: "です", reading: "です", gloss: "是" }] },
      collocations: [],
      note: null,
    },
    // "今日|きょう" intentionally missing.
  };
  writeFileSync(path, JSON.stringify(entries), "utf8");
  return path;
}

function cleanupPending(): void {
  if (existsSync(pendingPath(TEST_DATE))) rmSync(pendingPath(TEST_DATE));
}

describe("generate-daily 核心邏輯：3 詞批次中 1 詞 enrich 失敗（code review item 1, P0）", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__EXIT_${code}__`);
    }) as never);
    cleanupPending();
  });

  afterEach(() => {
    exitSpy.mockRestore();
    cleanupPending();
  });

  it("enrichCandidates：3 詞中 1 詞 enrich 失敗 -> 2 詞成功、1 筆 error，不 throw、不中斷批次", async () => {
    const enricher = FileEnricher(writeFixture());
    const { words, errors } = await enrichCandidates(CANDIDATES, IDS, enricher, []);

    expect(words).toHaveLength(2);
    expect(words.map((w) => w.surface).sort()).toEqual(["人", "私"]);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ id: "w_9903", surface: "今日", reading: "きょう" });
    expect(errors[0].detail).toMatch(/找不到/);
  });

  it("端到端：把 enrichCandidates 的結果照 main() 的邏輯寫入 pending，驗證 data/pending/<date>.json 的內容、exit(2)、以及不可 promote", async () => {
    const enricher = FileEnricher(writeFixture());
    const { words, errors } = await enrichCandidates(CANDIDATES, IDS, enricher, []);

    // Mirrors generate-daily.ts main()'s own "enrichErrors.length > 0" branch.
    expect(errors.length).toBeGreaterThan(0);
    const pipeline: PipelineMeta = {
      enricher: enricher.name,
      judge: "stub",
      generated_at: new Date().toISOString(),
      judgments: {},
      errors,
    };

    let exitError: unknown;
    try {
      await writePending(TEST_DATE, { date: TEST_DATE, words }, pipeline);
      printErrorSummary(TEST_DATE, "enrich", errors, words.length);
      process.exit(2);
    } catch (err) {
      exitError = err;
    }

    // (a) process exits with code 2.
    expect((exitError as Error).message).toBe("__EXIT_2__");
    expect(exitSpy).toHaveBeenCalledWith(2);

    // (b) data/pending/<date>.json exists.
    expect(existsSync(pendingPath(TEST_DATE))).toBe(true);

    // (c) it contains exactly the 2 successfully-enriched words.
    const written = JSON.parse(readFileSync(pendingPath(TEST_DATE), "utf8")) as PendingDayFile;
    expect(written.words).toHaveLength(2);
    expect(written.words.map((w) => w.surface).sort()).toEqual(["人", "私"]);

    // (d) it contains exactly 1 entry in pipeline.errors, for the missing word.
    expect(written.pipeline.errors).toHaveLength(1);
    expect(written.pipeline.errors?.[0].surface).toBe("今日");
    expect(written.pipeline.errors?.[0].reading).toBe("きょう");

    // (e) the word set is NOT promotable (too few words, and -- redundantly,
    // by design -- pipeline.errors is non-empty).
    expect(canPromote(written.words)).toBe(false);
    expect((written.pipeline.errors?.length ?? 0) > 0).toBe(true);
  });

  it("FileEnricher 對缺席的詞丟出的是 AiProviderError（不是普通 Error）-- 這正是讓上面的批次邏輯抓得到它的原因", async () => {
    const enricher = FileEnricher(writeFixture());
    let caught: unknown;
    try {
      await enricher.enrich({ surface: "今日", reading: "きょう", gloss: "今天", pos: "名詞", level: "N5", existing_surfaces: [] });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AiProviderError);
  });
});
