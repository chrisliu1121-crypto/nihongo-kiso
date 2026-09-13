import { describe, expect, it } from "vitest";
import { chunksOf, isPredicate, judgeArrange, shuffleChunks } from "../arrange";
import type { BuiltSentenceToken, Sentence } from "../../bank/types";

// Mirrors data/sentences/grammar-seed.json's s_g033 (私は七時に食堂で友達と朝ご飯を
// 食べます。), the one 6-bunsetsu sentence in the seed set -- reused here as a
// fixture rather than importing data/bank.json (gitignored; see
// src/lib/bank/__tests__/index.test.ts's own header comment on why bank.json
// is never imported from a test). morae/romaji are irrelevant to every judge
// under test here, so they're left empty rather than run through kanaToCells.
function tok(surface: string, reading: string, particle?: boolean): BuiltSentenceToken {
  return { surface, reading, gloss: surface, particle, morae: [], romaji: "" };
}

function makeSixBunsetsuSentence(overrides: Partial<Sentence> = {}): Sentence {
  const tokens: BuiltSentenceToken[] = [
    tok("私", "わたし"),
    tok("は", "は", true),
    tok("七時", "しちじ"),
    tok("に", "に", true),
    tok("食堂", "しょくどう"),
    tok("で", "で", true),
    tok("友達", "ともだち"),
    tok("と", "と", true),
    tok("朝ご飯", "あさごはん"),
    tok("を", "を", true),
    tok("食べます", "たべます"),
  ];
  return {
    id: "s_test033",
    pattern_id: null,
    level: "N5",
    tokens,
    bunsetsu: [[0, 1], [2, 3], [4, 5], [6, 7], [8, 9], [10]],
    valid_orders: [
      [0, 1, 2, 3, 4, 5],
      [0, 2, 1, 3, 4, 5],
    ],
    preferred_order: [0, 1, 2, 3, 4, 5],
    translation: "我七點在食堂和朋友吃早餐。",
    verified: true,
    tags: [],
    ja: "私は七時に食堂で友達と朝ご飯を食べます。",
    romaji: "",
    ...overrides,
  };
}

// A 2-bunsetsu sentence (私は学生です) for the smaller edge cases.
function makeTwoBunsetsuSentence(): Sentence {
  const tokens: BuiltSentenceToken[] = [
    tok("私", "わたし"),
    tok("は", "は", true),
    tok("学生", "がくせい"),
    tok("です", "です"),
  ];
  return {
    id: "s_test001",
    pattern_id: null,
    level: "N5",
    tokens,
    bunsetsu: [[0, 1], [2, 3]],
    valid_orders: [[0, 1]],
    preferred_order: [0, 1],
    translation: "我是學生。",
    verified: true,
    tags: [],
    ja: "私は学生です。",
    romaji: "",
  };
}

describe("isPredicate", () => {
  it("ます/です 結尾為 true", () => {
    expect(isPredicate("食べます")).toBe(true);
    expect(isPredicate("学生です")).toBe(true);
  });
  it("ません 結尾為 true", () => {
    expect(isPredicate("食べません")).toBe(true);
  });
  it("ています 結尾為 true（住んでいます）", () => {
    expect(isPredicate("住んでいます")).toBe(true);
  });
  it("たいです 結尾為 true（飲みたいです）", () => {
    expect(isPredicate("飲みたいです")).toBe(true);
  });
  it("一般名詞/助詞不是 true", () => {
    expect(isPredicate("私")).toBe(false);
    expect(isPredicate("は")).toBe(false);
    expect(isPredicate("食堂")).toBe(false);
  });
});

describe("chunksOf", () => {
  it("依 bunsetsu 切塊，isPredicate 只有最後一塊為 true", () => {
    const chunks = chunksOf(makeSixBunsetsuSentence());
    expect(chunks).toHaveLength(6);
    expect(chunks.map((c) => c.isPredicate)).toEqual([false, false, false, false, false, true]);
    expect(chunks[0].tokens.map((t) => t.surface)).toEqual(["私", "は"]);
    expect(chunks[5].tokens.map((t) => t.surface)).toEqual(["食べます"]);
  });
});

describe("judgeArrange", () => {
  const sentence = makeSixBunsetsuSentence();

  it("natural：命中 valid_orders 第一筆（preferred_order）", () => {
    expect(judgeArrange(sentence, [0, 1, 2, 3, 4, 5])).toEqual({ kind: "natural" });
  });

  it("natural：命中 valid_orders 第二筆（時間文節提前）", () => {
    expect(judgeArrange(sentence, [0, 2, 1, 3, 4, 5])).toEqual({ kind: "natural" });
  });

  it("acceptable：未列在 valid_orders，但動詞在尾、無重複 -- 主題文節挪到第二位", () => {
    const verdict = judgeArrange(sentence, [1, 0, 2, 3, 4, 5]);
    expect(verdict.kind).toBe("acceptable");
    if (verdict.kind === "acceptable") {
      expect(verdict.note).toMatch(/語感不同|較少見/);
    }
  });

  it("acceptable：受詞文節提到最前，仍合法但未列舉", () => {
    const verdict = judgeArrange(sentence, [4, 0, 1, 2, 3, 5]);
    expect(verdict.kind).toBe("acceptable");
  });

  it("invalid/verb_final：動詞文節不在最後", () => {
    const verdict = judgeArrange(sentence, [0, 1, 2, 3, 5, 4]);
    expect(verdict).toEqual({
      kind: "invalid",
      rule: "verb_final",
      note: expect.stringContaining("最後"),
    });
  });

  it("invalid/no_duplicate：重複塊且缺塊（長度相符但索引不是排列）", () => {
    const verdict = judgeArrange(sentence, [0, 1, 2, 3, 4, 4]);
    expect(verdict.kind).toBe("invalid");
    if (verdict.kind === "invalid") {
      expect(verdict.rule).toBe("no_duplicate");
    }
  });

  it("invalid/incomplete：尚未放完（長度小於塊數）", () => {
    const verdict = judgeArrange(sentence, [0, 1, 2]);
    expect(verdict).toEqual({
      kind: "invalid",
      rule: "incomplete",
      note: expect.stringContaining("排完"),
    });
  });

  it("incomplete 優先於 verb_final：不完整的排列不會被誤判成動詞不在尾", () => {
    // Last placed bunsetsu (index 2, 食堂で) is not the predicate, but the
    // reason this is invalid is "not done yet", not "verb misplaced".
    const verdict = judgeArrange(sentence, [0, 1, 2]);
    expect(verdict.kind).toBe("invalid");
    if (verdict.kind === "invalid") expect(verdict.rule).toBe("incomplete");
  });
});

describe("shuffleChunks", () => {
  const sentence = makeSixBunsetsuSentence();
  const chunks = chunksOf(sentence);

  it("同 seed 同輸入 -> 確定性相同輸出", () => {
    const a = shuffleChunks(chunks, 42);
    const b = shuffleChunks(chunks, 42);
    expect(a.map((c) => c.index)).toEqual(b.map((c) => c.index));
  });

  it("不同 seed 通常給不同順序（至少測試用的兩個 seed 確實不同）", () => {
    const a = shuffleChunks(chunks, 1).map((c) => c.index);
    const b = shuffleChunks(chunks, 2).map((c) => c.index);
    expect(a).not.toEqual(b);
  });

  it("洗完不得等於 avoidOrder（preferred_order）：多個 seed 皆驗證", () => {
    for (let seed = 0; seed < 10; seed++) {
      const result = shuffleChunks(chunks, seed, sentence.preferred_order).map((c) => c.index);
      expect(result).not.toEqual(sentence.preferred_order);
    }
  });

  it("是原陣列的排列，不遺漏不新增", () => {
    const result = shuffleChunks(chunks, 7);
    expect(result.map((c) => c.index).sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("單一/兩塊句子的 avoidOrder 邊界：不會無限迴圈", () => {
    const two = chunksOf(makeTwoBunsetsuSentence());
    const result = shuffleChunks(two, 0, [0, 1]);
    // With only 2 permutations of a 2-element array, avoiding [0,1] must
    // resolve to [1,0] -- verifies the retry loop actually finds it.
    expect(result.map((c) => c.index)).toEqual([1, 0]);
  });
});
