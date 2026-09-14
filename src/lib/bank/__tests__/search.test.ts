// Tests for the pure search helper in ../search.ts (re-exported by
// ../index.ts). Imported from "../search" directly, not "../index" -- same
// reason as ../dates.ts's own tests: ../index.ts imports the gitignored
// data/bank.json at module load time. See index.ts's header comment.

import { describe, expect, it } from "vitest";
import { filterWords, matchesWord } from "../search";
import type { Word } from "../types";

function makeWord(overrides: Partial<Word> = {}): Word {
  return {
    id: "w_0001",
    surface: "学校",
    reading: "がっこう",
    gloss: "學校",
    pos: "名詞",
    level: "N5",
    freq_rank: 1,
    romaji_override: null,
    morae: [],
    romaji: "gakkou",
    romaji_ascii: "gakkou",
    collocations: [],
    confusable_with: [],
    note: null,
    pitch: null,
    audio: null,
    source: "test",
    verified: true,
    example: {
      ja: "学校に行きます。",
      zh: "去學校。",
      tokens: [],
      romaji: "gakkou ni ikimasu",
    },
    ...overrides,
  };
}

describe("matchesWord", () => {
  const word = makeWord();

  it("空字串永遠命中", () => {
    expect(matchesWord(word, "")).toBe(true);
    expect(matchesWord(word, "   ")).toBe(true);
  });

  it("比對 surface（漢字）", () => {
    expect(matchesWord(word, "学校")).toBe(true);
  });

  it("比對 reading（假名）", () => {
    expect(matchesWord(word, "がっこう")).toBe(true);
  });

  it("比對 romaji_ascii，不分大小寫", () => {
    expect(matchesWord(word, "gakkou")).toBe(true);
    expect(matchesWord(word, "GAKKOU")).toBe(true);
    expect(matchesWord(word, "gak")).toBe(true);
  });

  it("比對 gloss（中文意思）", () => {
    expect(matchesWord(word, "學校")).toBe(true);
  });

  it("不比對其他欄位就沒有命中", () => {
    expect(matchesWord(word, "不存在的字串")).toBe(false);
  });
});

describe("filterWords", () => {
  const words = [
    makeWord({ id: "w_1", surface: "学校", reading: "がっこう", gloss: "學校", romaji_ascii: "gakkou" }),
    makeWord({ id: "w_2", surface: "先生", reading: "せんせい", gloss: "老師", romaji_ascii: "sensei" }),
  ];

  it("空 query 回傳原陣列（同一參考）", () => {
    expect(filterWords(words, "")).toBe(words);
  });

  it("依 romaji_ascii 過濾出子集", () => {
    expect(filterWords(words, "gakkou").map((w) => w.id)).toEqual(["w_1"]);
  });

  it("查無結果回傳空陣列", () => {
    expect(filterWords(words, "xyz")).toEqual([]);
  });
});
