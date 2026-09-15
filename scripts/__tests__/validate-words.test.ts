// scripts/__tests__/validate-words.test.ts — tests for scripts/lib/validate-words.ts
// (build task 2026-09 step 6: word-only validation/enrich logic extracted
// out of build-bank.ts). scripts/__tests__/build-bank.test.ts already pins
// enrichWord/validateBank's exact behavior via build-bank.ts's re-exports
// (unchanged, byte-for-byte) -- this file instead:
//   1. proves validateWordSet's error messages for the three cases the
//      build task calls out (duplicate id, particle mis-tagging,
//      non-increasing freq_rank) are IDENTICAL to what build-bank.test.ts
//      already asserts against the pre-refactor `validateBank` name, and
//   2. covers the NEW API (validateWordFile/WordValidationCtx) that
//      generate-daily.ts/cross-check.ts actually use, which build-bank.ts
//      never needed.

import { describe, expect, it } from "vitest";
import type { DaySeed, ExampleToken, WordSeed } from "../../src/lib/bank/types";
import {
  BuildError,
  enrichWord,
  validateWordFile,
  validateWordSet,
  type RawDay,
  type WordValidationCtx,
} from "../lib/validate-words";

const DEFAULT_TOKENS: ExampleToken[] = [
  { surface: "学校", reading: "がっこう", gloss: "學校" },
  { surface: "まで", reading: "まで", gloss: "（到）", particle: true },
  { surface: "歩いて", reading: "あるいて", gloss: "走路" },
  { surface: "行きます", reading: "いきます", gloss: "去" },
];

function makeSeed(overrides: Partial<WordSeed> = {}): WordSeed {
  return {
    id: "w_0001",
    surface: "学校",
    reading: "がっこう",
    gloss: "學校",
    pos: "名詞",
    level: "N5",
    freq_rank: 1,
    romaji_override: null,
    example: {
      ja: "学校まで歩いて行きます。",
      zh: "走路去學校。",
      tokens: DEFAULT_TOKENS,
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

function makeDay(file: string, words: WordSeed[]): RawDay {
  const date = file.replace(/\.json$/, "");
  const seed: DaySeed = { date, words };
  return { file, seed };
}

describe("enrichWord (default file/codec params)", () => {
  it("calling with just a seed uses the real codec and derives morae/romaji", () => {
    const word = enrichWord(makeSeed());
    expect(word.romaji).toBe("gakkō");
    expect(word.romaji_ascii).toBe("gakkou");
    expect(word.morae[0]).toEqual({ index: 0, text: "が", cells: ["ka"], marks: ["dakuten"], romaji: "ga" });
  });

  it("still accepts an explicit file/codec (build-bank.ts's own call shape, unchanged)", () => {
    const word = enrichWord(makeSeed({ id: "w_0002" }), "2026-09-05.json", {
      kanaToCells: () => enrichWord(makeSeed()).morae, // not exercised on this fixture; shape check only
      readingToRomaji: () => ({ romaji: "x", romaji_ascii: "y" }),
    });
    expect(word.id).toBe("w_0002");
  });
});

describe("validateWordSet -- error messages identical to the pre-refactor validateBank (build-bank.test.ts pins the same 重複 id / freq_rank cases against build-bank.ts's re-export)", () => {
  it("重複 id 被抓", () => {
    const dayA = makeDay(
      "2026-01-01.json",
      Array.from({ length: 10 }, (_, i) =>
        makeSeed({
          id: i === 0 ? "w_0099" : `w_010${i}`,
          surface: `甲${i}`,
          reading: "あ",
          freq_rank: i + 1,
        }),
      ),
    );
    const dayB = makeDay(
      "2026-01-02.json",
      Array.from({ length: 10 }, (_, i) =>
        makeSeed({
          id: i === 0 ? "w_0099" : `w_020${i}`,
          surface: `乙${i}`,
          reading: "い",
          freq_rank: 100 + i,
        }),
      ),
    );
    expect(() => validateWordSet([dayA, dayB])).toThrow(/id 與 2026-01-01\.json 重複/);
  });

  it("同檔內 freq_rank 未嚴格遞增被抓", () => {
    const day = makeDay(
      "2026-02-01.json",
      Array.from({ length: 10 }, (_, i) =>
        makeSeed({
          id: `w_050${i}`,
          surface: `戊${i}`,
          reading: "あ",
          freq_rank: i === 5 ? 3 : i + 1,
        }),
      ),
    );
    expect(() => validateWordSet([day])).toThrow(/freq_rank \(3\) 未嚴格遞增於前一詞 \(5\)/);
  });
});

// "particle 誤標" lives in enrichWord/enrichExampleToken, not validateWordSet
// (validateWordSet only checks cross-file id/surface+reading/freq_rank/
// confusable_with -- it never looks at example.tokens at all). This mirrors
// exactly where build-bank.test.ts's own pre-refactor assertion for this
// case lived (its `describe("enrichWord")` block, not `describe("validateBank")`).
describe("enrichWord -- particle 誤標 error message identical to the pre-refactor build-bank.test.ts assertion", () => {
  it("particle:true 但 surface 不在助詞白名單內被抓", () => {
    const build = () =>
      enrichWord(
        makeSeed({
          id: "w_0500",
          example: {
            ja: "はな学校です。",
            zh: "（測試用）",
            tokens: [
              { surface: "はな", reading: "はな", gloss: "花", particle: true },
              { surface: "学校です", reading: "がっこうです", gloss: "是學校" },
            ],
          },
        }),
        "particle-bad.json",
      );
    expect(build).toThrow(
      /^particle-bad\.json \/ w_0500 \/ example\.tokens\[0\] 標了 particle:true 但 surface "はな" 不在助詞白名單內/,
    );
  });
});

describe("validateWordFile", () => {
  const emptyCtx: WordValidationCtx = {
    existingIds: new Set(),
    existingSurfaceReading: new Set(),
    existingFreqRanks: new Set(),
    knownKanji: new Set(),
    existingExampleJa: new Map(),
  };

  // Each of the 10 words below needs its OWN distinct example.ja (review
  // item 5(b): example.ja must be unique bank-wide, and makeSeed()'s
  // default example is otherwise identical for every word) built from
  // plain kana only (review item 5(a): an example token's kanji must be
  // "in scope", and emptyCtx.knownKanji is empty on purpose -- these
  // fixtures aren't testing that check, so they simply never introduce a
  // kanji at all).
  const DISTINCT_KANA = ["あ", "い", "う", "え", "お", "か", "き", "く", "け", "こ"];

  function tenWords(overrides: Partial<WordSeed>[] = []): WordSeed[] {
    return Array.from({ length: 10 }, (_, i) => {
      const kana = DISTINCT_KANA[i];
      return makeSeed({
        id: `w_100${i}`,
        surface: `字${i}`,
        reading: "あ",
        freq_rank: i + 1,
        example: {
          ja: `${kana}です。`,
          zh: "測試",
          tokens: [
            { surface: kana, reading: kana, gloss: "測試" },
            { surface: "です", reading: "です", gloss: "是" },
          ],
        },
        ...overrides[i],
      });
    });
  }

  it("合法的一天（10 詞，不與 ctx 衝突）通過，回傳 10 個 enriched Word", () => {
    const words = tenWords();
    const seed: DaySeed = { date: "2026-03-01", words };
    const built = validateWordFile("2026-03-01.json", seed, emptyCtx);
    expect(built).toHaveLength(10);
    expect(built[0].romaji).toBeTypeOf("string");
  });

  it("與既有 bank 的 id 重複被抓", () => {
    const words = tenWords();
    const ctx: WordValidationCtx = { ...emptyCtx, existingIds: new Set([words[3].id]) };
    const seed: DaySeed = { date: "2026-03-02", words };
    expect(() => validateWordFile("2026-03-02.json", seed, ctx)).toThrow(/id 與既有 bank 或本檔內其他詞重複/);
  });

  it("與既有 bank 的 surface+reading 重複被抓", () => {
    const words = tenWords();
    const key = `${words[2].surface}|${words[2].reading}`;
    const ctx: WordValidationCtx = { ...emptyCtx, existingSurfaceReading: new Set([key]) };
    const seed: DaySeed = { date: "2026-03-03", words };
    expect(() => validateWordFile("2026-03-03.json", seed, ctx)).toThrow(
      /surface\+reading 與既有 bank 或本檔內其他詞重複/,
    );
  });

  it("與既有 bank 的 freq_rank 重複被抓", () => {
    const words = tenWords();
    const ctx: WordValidationCtx = { ...emptyCtx, existingFreqRanks: new Set([words[0].freq_rank]) };
    const seed: DaySeed = { date: "2026-03-04", words };
    expect(() => validateWordFile("2026-03-04.json", seed, ctx)).toThrow(
      /freq_rank 1 與既有 bank 或本檔內其他詞重複/,
    );
  });

  it("檔名/date 不符被抓", () => {
    const seed: DaySeed = { date: "2099-01-01", words: tenWords() };
    expect(() => validateWordFile("2026-03-05.json", seed, emptyCtx)).toThrow(
      /date 欄位 \(2099-01-01\) 與檔名 \(2026-03-05\) 不符/,
    );
  });

  it("不足 10 詞被抓", () => {
    const seed: DaySeed = { date: "2026-03-06", words: tenWords().slice(0, 3) };
    expect(() => validateWordFile("2026-03-06.json", seed, emptyCtx)).toThrow(/恰須 10 詞，實際 3/);
  });

  it("confusable_with 指向一個既有詞、但既有詞沒有回指時被抓", () => {
    const words = tenWords();
    words[0] = { ...words[0], confusable_with: ["w_existing"] };
    const ctx: WordValidationCtx = {
      ...emptyCtx,
      existingConfusableWith: new Map([["w_existing", []]]),
    };
    const seed: DaySeed = { date: "2026-03-07", words };
    expect(() => validateWordFile("2026-03-07.json", seed, ctx)).toThrow(/confusable_with 不對稱/);
  });

  it("confusable_with 指向一個既有詞、且既有詞已回指時不報錯", () => {
    const words = tenWords();
    words[0] = { ...words[0], confusable_with: ["w_existing"] };
    const ctx: WordValidationCtx = {
      ...emptyCtx,
      existingConfusableWith: new Map([["w_existing", [words[0].id]]]),
    };
    const seed: DaySeed = { date: "2026-03-08", words };
    expect(() => validateWordFile("2026-03-08.json", seed, ctx)).not.toThrow();
  });

  // review item 3 (P0): validateWordFile's FIRST step is a zod safeParse
  // against the whole day -- a shape problem must come back as a BuildError
  // with file/id/path info, never as a raw TypeError three functions later
  // inside enrichWord/enrichExampleToken.
  describe("schema 驗證（review item 3）：缺欄位/型別錯誤在第一步就被抓成 BuildError", () => {
    it("缺 example 欄位", () => {
      const words = tenWords() as unknown as Record<string, unknown>[];
      delete words[4].example;
      const seed = { date: "2026-04-01", words } as unknown as DaySeed;
      let caught: unknown;
      try {
        validateWordFile("2026-04-01.json", seed, emptyCtx);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(BuildError);
      expect((caught as Error).message).toMatch(/^2026-04-01\.json \/ w_1004 \/ schema 驗證失敗：words\.4\.example/);
    });

    it("collocations 給字串而非陣列", () => {
      const words = tenWords();
      const bad = { ...words[2], collocations: "不是陣列" } as unknown as WordSeed;
      const patched = [...words.slice(0, 2), bad, ...words.slice(3)];
      const seed = { date: "2026-04-02", words: patched } as unknown as DaySeed;
      let caught: unknown;
      try {
        validateWordFile("2026-04-02.json", seed, emptyCtx);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(BuildError);
      expect((caught as Error).message).toMatch(/^2026-04-02\.json \/ w_1002 \/ schema 驗證失敗：words\.2\.collocations/);
    });

    it("tokens 缺 reading", () => {
      const words = tenWords();
      const bad: WordSeed = {
        ...words[7],
        example: { ja: words[7].example.ja, zh: words[7].example.zh, tokens: [{ surface: "あ" } as unknown as ExampleToken] },
      };
      const patched = [...words.slice(0, 7), bad, ...words.slice(8)];
      const seed: DaySeed = { date: "2026-04-03", words: patched };
      let caught: unknown;
      try {
        validateWordFile("2026-04-03.json", seed, emptyCtx);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(BuildError);
      expect((caught as Error).message).toMatch(
        /^2026-04-03\.json \/ w_1007 \/ schema 驗證失敗：words\.7\.example\.tokens\.0\.reading/,
      );
    });

    it("tokens 缺 gloss（AI 漏產 gloss）被 zod 擋下", () => {
      const words = tenWords();
      const bad: WordSeed = {
        ...words[7],
        example: {
          ja: words[7].example.ja,
          zh: words[7].example.zh,
          tokens: [
            { surface: "く", reading: "く" } as unknown as ExampleToken,
            { surface: "です", reading: "です", gloss: "是" },
          ],
        },
      };
      const patched = [...words.slice(0, 7), bad, ...words.slice(8)];
      const seed: DaySeed = { date: "2026-04-09", words: patched };
      let caught: unknown;
      try {
        validateWordFile("2026-04-09.json", seed, emptyCtx);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(BuildError);
      expect((caught as Error).message).toMatch(
        /^2026-04-09\.json \/ w_1007 \/ schema 驗證失敗：words\.7\.example\.tokens\.0\.gloss/,
      );
    });
  });

  // review item 5(a): an example token's kanji must already be "in scope"
  // (present in the frequency table or an existing word's own surface).
  describe("例句超綱漢字（review item 5(a)）", () => {
    it("例句 token 含 ctx.knownKanji 之外的漢字被抓", () => {
      const words = tenWords();
      const bad: WordSeed = {
        ...words[0],
        example: {
          ja: "学校です。",
          zh: "是學校。",
          tokens: [
            { surface: "学校", reading: "がっこう", gloss: "學校" },
            { surface: "です", reading: "です", gloss: "是" },
          ],
        },
      };
      const patched = [bad, ...words.slice(1)];
      const seed: DaySeed = { date: "2026-04-04", words: patched };
      // emptyCtx.knownKanji is empty -- 学/校 are both out of scope.
      expect(() => validateWordFile("2026-04-04.json", seed, emptyCtx)).toThrow(/例句含超綱漢字：[学校]/);
    });

    it("同樣的漢字在 ctx.knownKanji 內時不報錯", () => {
      const words = tenWords();
      const bad: WordSeed = {
        ...words[0],
        example: {
          ja: "学校です。",
          zh: "是學校。",
          tokens: [
            { surface: "学校", reading: "がっこう", gloss: "學校" },
            { surface: "です", reading: "です", gloss: "是" },
          ],
        },
      };
      const patched = [bad, ...words.slice(1)];
      const seed: DaySeed = { date: "2026-04-05", words: patched };
      const ctx: WordValidationCtx = { ...emptyCtx, knownKanji: new Set(["学", "校"]) };
      expect(() => validateWordFile("2026-04-05.json", seed, ctx)).not.toThrow();
    });

    it("particle token 的 surface 不受漢字範圍檢查（沒有助詞會引入新漢字，但仍略過以防萬一）", () => {
      const words = tenWords();
      const bad: WordSeed = {
        ...words[0],
        example: {
          ja: `${DISTINCT_KANA[0]}では。`,
          zh: "測試",
          tokens: [
            { surface: DISTINCT_KANA[0], reading: DISTINCT_KANA[0], gloss: "測試" },
            { surface: "では", reading: "では", gloss: "（測試）", particle: true },
          ],
        },
      };
      const patched = [bad, ...words.slice(1)];
      const seed: DaySeed = { date: "2026-04-06", words: patched };
      expect(() => validateWordFile("2026-04-06.json", seed, emptyCtx)).not.toThrow();
    });
  });

  // review item 5(b): example.ja must be unique bank-wide, not just within one day.
  describe("例句重複（review item 5(b)）", () => {
    it("本檔內兩詞 example.ja 相同被抓", () => {
      const words = tenWords();
      const dup: WordSeed = { ...words[5], example: { ...words[0].example } };
      const patched = [...words.slice(0, 5), dup, ...words.slice(6)];
      const seed: DaySeed = { date: "2026-04-07", words: patched };
      expect(() => validateWordFile("2026-04-07.json", seed, emptyCtx)).toThrow(/例句與 w_1000 重複/);
    });

    it("與 ctx.existingExampleJa 裡的既有例句相同被抓", () => {
      const words = tenWords();
      const seed: DaySeed = { date: "2026-04-08", words };
      const ctx: WordValidationCtx = {
        ...emptyCtx,
        existingExampleJa: new Map([[words[3].example.ja, "w_existing"]]),
      };
      expect(() => validateWordFile("2026-04-08.json", seed, ctx)).toThrow(/例句與 w_existing 重複/);
    });
  });
});

describe("validateWordSet -- review item 5, opt-in via opts.knownKanji (off by default, so every pre-existing caller/test above and in build-bank.test.ts keeps its old behavior)", () => {
  function tenWordsWithExample(example: WordSeed["example"], overrides: Partial<WordSeed> = {}): WordSeed[] {
    return Array.from({ length: 10 }, (_, i) =>
      makeSeed({ id: `w_200${i}`, surface: `己${i}`, reading: "あ", freq_rank: i + 1, example, ...overrides }),
    );
  }

  it("不帶 opts 時完全不檢查漢字範圍或例句重複（向後相容既有測試/呼叫端）", () => {
    const days: RawDay[] = [makeDay("2026-05-01.json", tenWordsWithExample({ ...makeSeed().example }))];
    expect(() => validateWordSet(days)).not.toThrow();
  });

  it("帶 opts.knownKanji 時，例句含超綱漢字被抓", () => {
    const days: RawDay[] = [
      makeDay(
        "2026-05-02.json",
        tenWordsWithExample({
          ja: "学校です。",
          zh: "是學校。",
          tokens: [
            { surface: "学校", reading: "がっこう", gloss: "學校" },
            { surface: "です", reading: "です", gloss: "是" },
          ],
        }),
      ),
    ];
    expect(() => validateWordSet(days, { knownKanji: new Set() })).toThrow(/例句含超綱漢字/);
  });

  it("帶 opts.knownKanji 時，跨檔 example.ja 重複也被抓", () => {
    const sameExample: WordSeed["example"] = {
      ja: "あです。",
      zh: "測試",
      tokens: [
        { surface: "あ", reading: "あ", gloss: "測試" },
        { surface: "です", reading: "です", gloss: "是" },
      ],
    };
    const dayA = makeDay(
      "2026-05-03.json",
      Array.from({ length: 10 }, (_, i) =>
        makeSeed({ id: `w_300${i}`, surface: `庚${i}`, reading: "あ", freq_rank: i + 1, example: sameExample }),
      ),
    );
    // dayA's own 10 words already collide with EACH OTHER on example.ja
    // (deliberately, to test the check with a single call) -- no second
    // day needed.
    expect(() => validateWordSet([dayA], { knownKanji: new Set() })).toThrow(/例句與 w_3000 重複/);
  });
});

// DESIGN.md §9.2: example-token gloss rules, enforced inside enrichWord's
// per-token pass so build-bank.ts (which never runs the zod schema) also
// fails loud on a hand-edited data/words/*.json.
describe("example token gloss（DESIGN.md §9.2）", () => {
  function withTokenGloss(index: number, gloss: unknown): WordSeed {
    const seed = makeSeed();
    const tokens = seed.example.tokens.map((t, i) => (i === index ? ({ ...t, gloss } as ExampleToken) : t));
    return { ...seed, example: { ...seed.example, tokens } };
  }

  it("預設 fixture（每個 token 都有中文 gloss，含助詞括號說明「（到）」）通過，gloss 帶進 built token", () => {
    const word = enrichWord(makeSeed(), "g.json");
    expect(word.example.tokens.map((t) => t.gloss)).toEqual(["學校", "（到）", "走路", "去"]);
  });

  it("缺 gloss 被抓，訊息指到 file / id / example.tokens[i]", () => {
    const seed = makeSeed();
    const tokens = seed.example.tokens.map((t, i) => {
      if (i !== 2) return t;
      const { gloss: _omit, ...rest } = t;
      return rest as ExampleToken;
    });
    const build = () => enrichWord({ ...seed, example: { ...seed.example, tokens } }, "g.json");
    expect(build).toThrow(BuildError);
    expect(build).toThrow(/^g\.json \/ w_0001 \/ example\.tokens\[2\] "歩いて" 缺少 gloss/);
  });

  it("gloss 為空白字串被抓", () => {
    expect(() => enrichWord(withTokenGloss(0, "   "), "g.json")).toThrow(/^g\.json \/ w_0001 \/ example\.tokens\[0\] "学校" 缺少 gloss/);
  });

  it("gloss 含平假名（把讀音當意思：たべる）被抓", () => {
    const build = () => enrichWord(withTokenGloss(3, "たべる"), "g.json");
    expect(build).toThrow(BuildError);
    expect(build).toThrow(/^g\.json \/ w_0001 \/ example\.tokens\[3\] "行きます" 的 gloss 含假名「た」/);
  });

  it("gloss 含片假名或長音符「ー」也被抓", () => {
    expect(() => enrichWord(withTokenGloss(0, "ガッコウ"), "g.json")).toThrow(/example\.tokens\[0\] "学校" 的 gloss 含假名/);
    expect(() => enrichWord(withTokenGloss(0, "學校ー"), "g.json")).toThrow(/的 gloss 含假名「ー」/);
  });

  it("中文標點、全形括號與片假名中點「・」不算假名，放行", () => {
    expect(() => enrichWord(withTokenGloss(1, "（到）"), "g.json")).not.toThrow();
    expect(() => enrichWord(withTokenGloss(2, "走路・步行"), "g.json")).not.toThrow();
    expect(() => enrichWord(withTokenGloss(3, "去，前往。"), "g.json")).not.toThrow();
  });
});

// Kana-only surface must match its reading (toHiragana-normalized). A particle
// written with its pronunciation (へ/え, は/わ, を/お) would light the wrong
// gojuon cell -- a real bug the 2026-09-15 cron produced (w_0045).
describe("example token：純假名 surface 與 reading 必須是同一組假名", () => {
  function seedWith(ja: string, tokens: ExampleToken[]): WordSeed {
    return makeSeed({ id: "w_0001", example: { ja, zh: "測試", tokens } });
  }

  it.each([
    ["へ", "え", "学校へ行きます。", [{ surface: "学校", reading: "がっこう", gloss: "學校" }, { surface: "へ", reading: "え", gloss: "（往）", particle: true }, { surface: "行きます", reading: "いきます", gloss: "去" }]],
    ["は", "わ", "学校は大きいです。", [{ surface: "学校", reading: "がっこう", gloss: "學校" }, { surface: "は", reading: "わ", gloss: "（主題）", particle: true }, { surface: "大きいです", reading: "おおきいです", gloss: "很大" }]],
    ["を", "お", "水を飲みます。", [{ surface: "水", reading: "みず", gloss: "水" }, { surface: "を", reading: "お", gloss: "（受詞）", particle: true }, { surface: "飲みます", reading: "のみます", gloss: "喝" }]],
  ] as const)("助詞 %s 的 reading 寫成發音 %s 被擋，訊息指到 example.tokens[1] 並說明寫字形", (surface, reading, ja, tokens) => {
    const build = () => enrichWord(seedWith(ja, tokens as unknown as ExampleToken[]), "r.json");
    expect(build).toThrow(BuildError);
    expect(build).toThrow(`r.json / w_0001 / example.tokens[1] surface "${surface}" 與 reading "${reading}" 不一致`);
    expect(build).toThrow(/助詞 は\/へ\/を 的 reading 寫字形本身（は\/へ\/を），發音由 particle:true 處理/);
  });

  it("片假名 surface：トイレ/トイレ 與 トイレ/といれ 都通過", () => {
    const tokens = (reading: string): ExampleToken[] => [
      { surface: "トイレ", reading, gloss: "洗手間" },
      { surface: "です", reading: "です", gloss: "是" },
    ];
    expect(() => enrichWord(seedWith("トイレです。", tokens("トイレ")), "r.json")).not.toThrow();
    expect(() => enrichWord(seedWith("トイレです。", tokens("といれ")), "r.json")).not.toThrow();
  });

  it("標點與引號先去掉再比：「ありがとう」/ありがとう 通過；「へ」/え 仍被擋；ー 保留不算標點", async () => {
    const { surfaceReadingMismatchReason } = await import("../lib/validate-words");
    expect(surfaceReadingMismatchReason("「ありがとう」", "ありがとう")).toBeNull();
    expect(surfaceReadingMismatchReason("『ね』！", "ね")).toBeNull();
    expect(surfaceReadingMismatchReason("「へ」", "え")).toContain('surface "「へ」" 與 reading "え" 不一致');
    expect(surfaceReadingMismatchReason("ケーキ", "けーき")).toBeNull();
    expect(surfaceReadingMismatchReason("ケーキ", "けき")).not.toBeNull();
  });

  it("含漢字的 surface 不套這條（学校/がっこう 照常通過）", () => {
    expect(() => enrichWord(makeSeed(), "r.json")).not.toThrow();
  });
});
