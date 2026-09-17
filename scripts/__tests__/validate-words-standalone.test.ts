// scripts/__tests__/validate-words-standalone.test.ts — 2026-09-17 "卡死"
// fix (DESIGN.md §9.1a): validateWordStandalone is the new entry point that
// returns EVERY problem a single word has, instead of throwing (BuildError)
// on the first one the way enrichWord/validateWordFile do. These tests
// reproduce the three real mistakes the 2026-09-16/17 cron actually made
// (番号's 号, 答え's 答, and a token reading with a kanji spliced into it --
// see scripts/__tests__/validate-words.test.ts's own "surface/reading" describe
// block for the same class of bug, "数" version) plus a word with more than
// one problem at once, to prove nothing gets dropped.

import { describe, expect, it } from "vitest";
import type { DaySeed, ExampleToken, WordSeed } from "../../src/lib/bank/types";
import { BuildError, validateWordFile, validateWordStandalone, type StandaloneWordCtx, type WordValidationCtx } from "../lib/validate-words";

function makeSeed(overrides: Partial<WordSeed> = {}): WordSeed {
  return {
    id: "w_0001",
    surface: "一",
    reading: "いち",
    gloss: "一",
    pos: "名詞",
    level: "N5",
    freq_rank: 54,
    romaji_override: null,
    example: {
      ja: "一です。",
      zh: "是一。",
      tokens: [
        { surface: "一", reading: "いち", gloss: "一" },
        { surface: "です", reading: "です", gloss: "是" },
      ],
    },
    collocations: [],
    confusable_with: [],
    note: null,
    pitch: null,
    audio: null,
    source: "n5-freq",
    verified: false,
    ...overrides,
  };
}

const EMPTY_CTX: StandaloneWordCtx = {
  knownKanji: new Set(["一", "番"]), // 番 is in scope, 号/答 deliberately are not
  existingExampleJa: new Set(),
  batchExampleJa: new Map(),
};

describe("validateWordStandalone -- the three 2026-09-16/17 mistakes, reproduced individually", () => {
  it("「番号」：番 在範圍內、号 不在 -- 只有 号 被列為超綱漢字", () => {
    const seed = makeSeed({
      example: {
        ja: "番号は一です。",
        zh: "號碼是一。",
        tokens: [
          { surface: "番号", reading: "ばんごう", gloss: "號碼" },
          { surface: "は", reading: "は", gloss: "（主題）", particle: true },
          { surface: "一", reading: "いち", gloss: "一" },
          { surface: "です", reading: "です", gloss: "是" },
        ],
      },
    });
    const problems = validateWordStandalone(seed, EMPTY_CTX, "2026-09-16.json");
    expect(problems.some((p) => p.includes("超綱漢字：号"))).toBe(true);
    expect(problems.some((p) => p.includes("超綱漢字：番"))).toBe(false);
    for (const p of problems) expect(p.startsWith("2026-09-16.json / w_0001 / ")).toBe(true);
  });

  it("「答え」：答 不在範圍內 -- 被列為超綱漢字", () => {
    const seed = makeSeed({
      example: {
        ja: "答えは四です。",
        zh: "答案是四。",
        tokens: [
          { surface: "答え", reading: "こたえ", gloss: "答案" },
          { surface: "は", reading: "は", gloss: "（主題）", particle: true },
          { surface: "四", reading: "よん", gloss: "四" },
          { surface: "です", reading: "です", gloss: "是" },
        ],
      },
    });
    const ctx: StandaloneWordCtx = { ...EMPTY_CTX, knownKanji: new Set(["一", "番", "四"]) };
    const problems = validateWordStandalone(seed, ctx, "2026-09-16.json");
    expect(problems.some((p) => p.includes("超綱漢字：答"))).toBe(true);
  });

  it("token 的 reading 裡塞了漢字（如「数」）-- 被抓成非假名字元，不是靜默通過", () => {
    const seed = makeSeed({
      example: {
        ja: "数字です。",
        zh: "是數字。",
        tokens: [
          // "数字" surface but the reading has a kanji spliced in instead of
          // pure kana -- exactly the 2026-09-16 "七" incident's shape.
          { surface: "数字", reading: "すう数じ", gloss: "數字" },
          { surface: "です", reading: "です", gloss: "是" },
        ],
      },
    });
    const ctx: StandaloneWordCtx = { ...EMPTY_CTX, knownKanji: new Set(["一", "数", "字"]) };
    const problems = validateWordStandalone(seed, ctx, "f.json");
    expect(problems.some((p) => p.includes("含非假名字元") && p.includes("数"))).toBe(true);
  });

  it("一個詞同時有多個問題時，全部都回傳（不是只回傳第一個）", () => {
    const seed = makeSeed({
      example: {
        ja: "番号と答えです。",
        zh: "號碼和答案。",
        tokens: [
          { surface: "番号", reading: "ばんごう", gloss: "號碼" },
          { surface: "と", reading: "と", gloss: "（和）", particle: true },
          { surface: "答え", reading: "こたえ", gloss: "" }, // also missing gloss
          { surface: "です", reading: "です", gloss: "是" },
        ],
      },
    });
    const problems = validateWordStandalone(seed, EMPTY_CTX, "multi.json");
    expect(problems.some((p) => p.includes("超綱漢字：号"))).toBe(true);
    expect(problems.some((p) => p.includes("超綱漢字：答"))).toBe(true);
    expect(problems.some((p) => p.includes("缺少 gloss"))).toBe(true);
    // At least the three distinct problems above must all be present at once.
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });

  it("通過的詞回傳空陣列", () => {
    expect(validateWordStandalone(makeSeed(), EMPTY_CTX, "ok.json")).toEqual([]);
  });

  it("與既有 bank 的例句重複被抓", () => {
    const ctx: StandaloneWordCtx = { ...EMPTY_CTX, existingExampleJa: new Set(["一です。"]) };
    const problems = validateWordStandalone(makeSeed(), ctx, "dup.json");
    expect(problems.some((p) => p.includes("例句與既有 bank 重複"))).toBe(true);
  });

  it("與同一批次（本次執行）已接受的詞例句重複被抓", () => {
    const ctx: StandaloneWordCtx = { ...EMPTY_CTX, batchExampleJa: new Map([["一です。", "一|いち"]]) };
    const seed = makeSeed({ id: "w_0002" }); // different id -- batchOwner "一|いち" !== "w_0002"
    const problems = validateWordStandalone(seed, ctx, "dup2.json");
    expect(problems.some((p) => p.includes("例句與本批次 一|いち 重複"))).toBe(true);
  });

  it("zod 形狀錯誤時只回傳 schema 問題（不會因為後續存取 undefined 欄位而炸掉）", () => {
    const bad = { ...makeSeed(), collocations: "不是陣列" } as unknown as WordSeed;
    const problems = validateWordStandalone(bad, EMPTY_CTX, "shape.json");
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((p) => p.includes("schema 驗證失敗"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2026-09-18 P2 fix: validateWordStandalone and validateWordFile used to
// have two independently-worded messages for the same underlying "超綱漢字"
// mistake (validateWordFile's checkExampleKanjiScope and
// validateWordStandalone's own collectExampleTokenProblems). They now share
// one message-building function (kanjiScopeProblem, validate-words.ts) so a
// human reading BOTH a validateWordFile BuildError and a
// validateWordStandalone problem list for the exact same mistake sees
// IDENTICAL text, not two different sentences describing the same thing.
// These parity tests build the SAME bad word both ways and assert
// validateWordFile's thrown message string appears VERBATIM inside
// validateWordStandalone's returned array, for every problem class that
// both functions independently implement (kanji scope, reading contains
// kanji, gloss contains kana) -- reading-legality and gloss-content already
// shared identical wording before this fix (both were copied verbatim from
// enrichWord's own checks when validateWordStandalone was first written);
// only kanji-scope had drifted, which is exactly what this fix targets.

const DISTINCT_KANA = ["あ", "い", "う", "え", "お", "か", "き", "く", "け", "こ"];

function makeParityWord(overrides: Partial<WordSeed>, index: number): WordSeed {
  const kana = DISTINCT_KANA[index];
  return {
    id: `w_200${index}`,
    surface: `字${index}`,
    reading: "あ",
    gloss: "測試",
    pos: "名詞",
    level: "N5",
    freq_rank: index + 1,
    romaji_override: null,
    example: {
      ja: `${kana}です。`,
      zh: "測試",
      tokens: [
        { surface: kana, reading: kana, gloss: "測試" },
        { surface: "です", reading: "です", gloss: "是" },
      ],
    },
    collocations: [],
    confusable_with: [],
    note: null,
    pitch: null,
    audio: null,
    source: "seed-manual",
    verified: true,
    ...overrides,
  };
}

/** A full, otherwise-valid 10-word day (validateWordFile requires exactly WORDS_PER_DAY) with word[0] replaced by `badWord0`. */
function dayWithBadFirstWord(date: string, badWord0: WordSeed): DaySeed {
  const words = Array.from({ length: 10 }, (_, i) => makeParityWord({}, i));
  return { date, words: [badWord0, ...words.slice(1)] };
}

const PARITY_EMPTY_CTX: WordValidationCtx = {
  existingIds: new Set(),
  existingSurfaceReading: new Set(),
  existingFreqRanks: new Set(),
  knownKanji: new Set(),
  existingExampleJa: new Map(),
};

/** Run `seed` through validateWordFile and return the thrown BuildError's message -- fails the test (via a thrown assertion) if it doesn't throw, since every parity case here is deliberately invalid. */
function thrownMessage(file: string, seed: DaySeed, ctx: WordValidationCtx): string {
  try {
    validateWordFile(file, seed, ctx);
  } catch (err) {
    expect(err).toBeInstanceOf(BuildError);
    return (err as Error).message;
  }
  throw new Error("expected validateWordFile to throw, but it didn't");
}

describe("parity: validateWordFile's thrown message appears verbatim in validateWordStandalone's problem list", () => {
  it("超綱漢字", () => {
    const badWord0 = makeParityWord(
      {
        id: "w_2000",
        example: {
          ja: "学校です。",
          zh: "是學校。",
          tokens: [
            { surface: "学校", reading: "がっこう", gloss: "學校" },
            { surface: "です", reading: "です", gloss: "是" },
          ],
        },
      },
      0,
    );
    const file = "2026-07-01.json";
    const seed = dayWithBadFirstWord("2026-07-01", badWord0);
    const message = thrownMessage(file, seed, PARITY_EMPTY_CTX);
    expect(message).toContain("超綱漢字");

    const standaloneProblems = validateWordStandalone(badWord0, { knownKanji: new Set(), existingExampleJa: new Set(), batchExampleJa: new Map() }, file);
    expect(standaloneProblems).toContain(message);
  });

  it("reading 含漢字（非假名字元）", () => {
    // Surface is deliberately pure-kana (no kanji at all) so
    // checkExampleKanjiScope has nothing to object to and doesn't fire
    // first -- this isolates the reading-legality check (kanaToCells
    // throwing on the spliced-in kanji "数") as the one BuildError.
    const badTokens: ExampleToken[] = [
      { surface: "すうじ", reading: "すう数じ", gloss: "數字" },
      { surface: "です", reading: "です", gloss: "是" },
    ];
    const badWord0 = makeParityWord({ id: "w_2000", example: { ja: "すうじです。", zh: "是數字。", tokens: badTokens } }, 0);
    const file = "2026-07-02.json";
    const seed = dayWithBadFirstWord("2026-07-02", badWord0);
    const message = thrownMessage(file, seed, PARITY_EMPTY_CTX);
    expect(message).toContain("含非假名字元");

    const standaloneProblems = validateWordStandalone(badWord0, { knownKanji: new Set(), existingExampleJa: new Set(), batchExampleJa: new Map() }, file);
    expect(standaloneProblems).toContain(message);
  });

  it("gloss 含假名", () => {
    const badTokens: ExampleToken[] = [
      { surface: "あ", reading: "あ", gloss: "たべる" }, // reading pasted in where the meaning belongs
      { surface: "です", reading: "です", gloss: "是" },
    ];
    const badWord0 = makeParityWord({ id: "w_2000", example: { ja: "あです。", zh: "測試", tokens: badTokens } }, 0);
    const file = "2026-07-03.json";
    const seed = dayWithBadFirstWord("2026-07-03", badWord0);
    const message = thrownMessage(file, seed, PARITY_EMPTY_CTX);
    expect(message).toContain("的 gloss 含假名");

    const standaloneProblems = validateWordStandalone(badWord0, { knownKanji: new Set(), existingExampleJa: new Set(), batchExampleJa: new Map() }, file);
    expect(standaloneProblems).toContain(message);
  });
});
