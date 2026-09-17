// scripts/__tests__/generate-daily-fixture-rank51.test.ts — 2026-09-17 "卡死"
// fix, automated version of the build task's acceptance step 3: reproduces
// the real 2026-09-16/17 failure (frequency-table rank 51-60, "一"'s example
// using the out-of-scope kanji 号 in "番号は一です。") against the REAL
// data/frequency/n5.json and a synthetic "rank 1-50 already published" bank (independent of data/words/), using
// scripts/__tests__/fixtures/rank51-60-one-retry.json as the Enricher's
// pre-recorded answers ("一"'s entry is a 3-element array: bad, bad again
// [mirroring 09-16 -> 09-17 repeating the exact same mistake], then good in
// hiragana -- see that fixture file's own content). Fully offline: no
// network, --judge stub.

import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { FileEnricher } from "../lib/ai/file";
import { StubJudge } from "../lib/ai/stub";
import { buildWordCtx, loadExistingWordDays, FREQUENCY_PATH } from "../lib/pending";
import { finalizeAcceptedWords, MAX_CANDIDATES, pickCandidatePool, runGenerationPipeline, type FrequencyWord } from "../generate-daily";

const FIXTURE_PATH = fileURLToPath(new URL("./fixtures/rank51-60-one-retry.json", import.meta.url));

describe("generate-daily against the REAL rank 51-60 batch (reproduces the 2026-09-16/17 failure offline)", () => {
  it("「一」通過驗證在第 3 次嘗試；其餘 9 詞第 1 次就通過；最終湊滿 10 詞", async () => {
    const freqRaw = await readFile(FREQUENCY_PATH, "utf8");
    const freq = JSON.parse(freqRaw) as { words: FrequencyWord[] };
    // Self-contained: pretend exactly rank 1-50 are already published, so the
    // candidate pool is rank 51-60 regardless of what data/words/ holds today
    // (this batch went live on 2026-09-16/17; reading the real bank made the
    // test fail in CI the moment it did, which blocked deploys).
    const existingDays: Awaited<ReturnType<typeof loadExistingWordDays>> = [];
    const existingKeys = new Set(freq.words.filter((w) => w.rank <= 50).map((w) => `${w.surface}|${w.reading}`));
    const ctx = buildWordCtx(existingDays, freq.words.map((w) => w.surface));

    const pool = pickCandidatePool(freq.words, existingKeys, MAX_CANDIDATES);
    // Sanity check on the fixture itself: the real frequency table's first
    // 10 not-yet-published candidates must be exactly rank 51-60 (いくつ..七)
    // for this test to actually be exercising the real incident's batch.
    expect(pool.slice(0, 10).map((w) => w.surface)).toEqual(["いくつ", "いくら", "どんな", "一", "二", "三", "四", "五", "六", "七"]);

    const result = await runGenerationPipeline({
      candidates: pool,
      enricher: FileEnricher(FIXTURE_PATH),
      judge: StubJudge,
      existingSurfaces: [],
      existingExamples: [],
      knownKanji: ctx.knownKanji,
      existingExampleJa: new Set(ctx.existingExampleJa.keys()),
      date: "2026-12-30",
    });

    expect(result.aborted).toBeUndefined();
    expect(result.accepted).toHaveLength(10);
    expect(result.skipped).toEqual([]);

    // "一" needed 3 attempts (2 recorded failures before the accepted 3rd).
    expect(result.attempts["一|いち"]).toHaveLength(2);
    expect(result.attempts["一|いち"].every((a) => a.stage === "validate")).toBe(true);
    expect(result.attempts["一|いち"][0].problems.some((p) => p.includes("超綱漢字：号"))).toBe(true);

    // Every other word passed on the first try -- no attempts entry at all.
    for (const surface of ["いくつ", "いくら", "どんな", "二", "三", "四", "五", "六", "七"]) {
      const freqWord = pool.find((w) => w.surface === surface)!;
      expect(result.attempts[`${freqWord.surface}|${freqWord.reading}`]).toBeUndefined();
    }

    const { words } = finalizeAcceptedWords(existingDays, result.accepted);
    expect(words).toHaveLength(10);
    expect(words.every((w) => w.verified)).toBe(true);
    // freq_rank strictly increasing, ids continuous (finalizeAcceptedWords's own contract).
    for (let i = 1; i < words.length; i++) {
      expect(words[i].freq_rank).toBeGreaterThan(words[i - 1].freq_rank);
    }
    const oneWord = words.find((w) => w.surface === "一")!;
    expect(oneWord.example.ja).toBe("ばんごうは一です。"); // the 3rd (accepted) attempt's content, not the first two
  });
});
