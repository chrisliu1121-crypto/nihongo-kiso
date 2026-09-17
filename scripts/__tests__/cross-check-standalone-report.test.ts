// scripts/__tests__/cross-check-standalone-report.test.ts — 2026-09-17 "卡死"
// fix (DESIGN.md §9.1a point 4): scripts/cross-check.ts's program-validation
// step now runs validateWordStandalone over every word FIRST and reports
// EVERY problem across the whole file in one pass, instead of
// validateWordFile's original "throw on the first BuildError" behavior
// (validateWordFile itself is unchanged and still runs afterward, as the
// authority for cross-file structural checks -- see cross-check.ts's own
// updated comment). This is what the build task's acceptance step 4 checks
// manually against a real 3-problem pending file; this test proves the same
// thing offline through crossCheckOne directly.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import type { WordSeed } from "../../src/lib/bank/types";
import { StubEnricher } from "../lib/ai/stub";
import { buildWordCtx, pendingPath, wordsPath, type PendingDayFile, type PipelineMeta } from "../lib/pending";
import { assembleSeed, writePending, type FrequencyWord } from "../generate-daily";
import { crossCheckOne } from "../cross-check";

const TEST_DATE = "1999-04-01";

const FREQ: FrequencyWord[] = [
  { rank: 1, surface: "あなた", reading: "あなた", gloss: "你", pos: "代名詞" },
  { rank: 2, surface: "それ", reading: "それ", gloss: "那個", pos: "代名詞" },
  { rank: 3, surface: "あれ", reading: "あれ", gloss: "那個(遠)", pos: "代名詞" },
  { rank: 4, surface: "ここ", reading: "ここ", gloss: "這裡", pos: "代名詞" },
  { rank: 5, surface: "そこ", reading: "そこ", gloss: "那裡", pos: "代名詞" },
  { rank: 6, surface: "あそこ", reading: "あそこ", gloss: "那裡(遠)", pos: "代名詞" },
  { rank: 7, surface: "みんな", reading: "みんな", gloss: "大家", pos: "名詞" },
  { rank: 8, surface: "とても", reading: "とても", gloss: "非常", pos: "副詞" },
  { rank: 9, surface: "これ", reading: "これ", gloss: "這個", pos: "代名詞" },
  { rank: 10, surface: "どこ", reading: "どこ", gloss: "哪裡", pos: "疑問詞" },
];
const IDS = FREQ.map((_, i) => `w_88${String(i + 1).padStart(2, "0")}`);

async function buildTenWords(): Promise<WordSeed[]> {
  const words: WordSeed[] = [];
  for (let i = 0; i < FREQ.length; i++) {
    const enriched = await StubEnricher.enrich({ surface: FREQ[i].surface, reading: FREQ[i].reading, gloss: FREQ[i].gloss, pos: FREQ[i].pos, level: "N5", existing_surfaces: [] });
    words.push({ ...assembleSeed(FREQ[i], enriched, IDS[i]), verified: false });
  }
  return words;
}

function cleanup(): void {
  if (existsSync(pendingPath(TEST_DATE))) rmSync(pendingPath(TEST_DATE));
  if (existsSync(wordsPath(TEST_DATE))) rmSync(wordsPath(TEST_DATE));
}

describe("cross-check.ts -- validateWordStandalone 一次列出整個檔案裡的全部問題（不再只報第一個）", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    cleanup();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    errorSpy.mockRestore();
  });

  it("a pending file with 3 distinct word-level problems: crossCheckOne reports all 3 in one pass and returns false", async () => {
    const words = await buildTenWords();

    // Problem 1: word[0] gets an out-of-scope-kanji example (knownKanji
    // below is built with NO surfaces at all, so any kanji is out of scope).
    words[0] = {
      ...words[0],
      example: { ja: "資料です。", zh: "是資料。", tokens: [{ surface: "資料", reading: "しりょう", gloss: "資料" }, { surface: "です", reading: "です", gloss: "是" }] },
    };
    // Problem 2: word[1] has a token missing its gloss.
    words[1] = {
      ...words[1],
      example: { ja: `${words[1].surface}です。`, zh: "測試", tokens: [{ surface: words[1].surface, reading: words[1].reading, gloss: "" }, { surface: "です", reading: "です", gloss: "是" }] },
    };
    // Problem 3: word[2] has a particle (へ) whose reading was written as
    // its pronunciation (え) instead of its own character -- the real
    // 2026-09-15 incident DESIGN.md §9.2 documents.
    words[2] = {
      ...words[2],
      example: {
        ja: `${words[2].surface}へ行きます。`,
        zh: "去。",
        tokens: [
          { surface: words[2].surface, reading: words[2].reading, gloss: "測試" },
          { surface: "へ", reading: "え", gloss: "（往）", particle: true },
          { surface: "行きます", reading: "いきます", gloss: "去" },
        ],
      },
    };

    const pipeline: PipelineMeta = { enricher: "stub", judge: "stub", generated_at: new Date().toISOString(), judgments: {}, errors: [] };
    await writePending(TEST_DATE, { date: TEST_DATE, words }, pipeline);

    const ctx = buildWordCtx([], []); // empty knownKanji -- both 資 and 料 are out of scope
    const ok = await crossCheckOne(TEST_DATE, "stub", ctx, false, [], {}, undefined, undefined, []);

    expect(ok).toBe(false);
    expect(existsSync(pendingPath(TEST_DATE))).toBe(true); // not promoted, nothing removed

    const loggedText = errorSpy.mock.calls.flat().map((v: unknown) => String(v)).join("\n");
    // 5 total findings across the 3 deliberately-broken words (word[0]'s
    // example introduces TWO out-of-scope kanji -- 資 and 料 -- word[2]'s
    // 行きます also introduces 行 since ctx.knownKanji is empty here; the
    // point of this test is that ALL of them come back in one pass, not
    // that the count is exactly 3).
    expect(loggedText).toMatch(/共 5 個問題/);
    expect(loggedText).toContain("超綱漢字：資");
    expect(loggedText).toContain("超綱漢字：料");
    expect(loggedText).toContain("缺少 gloss");
    expect(loggedText).toContain('surface "へ" 與 reading "え" 不一致');

    // The pending file on disk is untouched content-wise (crossCheckOne's
    // validation-failure path returns before writing anything back).
    const stillPending = JSON.parse(readFileSync(pendingPath(TEST_DATE), "utf8")) as PendingDayFile;
    expect(stillPending.words).toHaveLength(10);
  });

  it("a clean 10-word file: no standalone problems reported, validateWordFile's own (still first-error-only) checks still run afterward", async () => {
    const words = await buildTenWords();
    const pipeline: PipelineMeta = { enricher: "stub", judge: "stub", generated_at: new Date().toISOString(), judgments: {}, errors: [] };
    await writePending(TEST_DATE, { date: TEST_DATE, words }, pipeline);

    const ctx = buildWordCtx([], FREQ.map((f) => f.surface));
    const ok = await crossCheckOne(TEST_DATE, "stub", ctx, true, [], {}, undefined, undefined, []);

    expect(ok).toBe(true);
    expect(existsSync(pendingPath(TEST_DATE))).toBe(false); // promoted
    expect(existsSync(wordsPath(TEST_DATE))).toBe(true);
  });
});
