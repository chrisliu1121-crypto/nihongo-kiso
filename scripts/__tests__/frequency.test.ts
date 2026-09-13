// scripts/__tests__/frequency.test.ts — build task 2026-09 step 6:
// mechanical checks on data/frequency/n5.json. This can't check that any
// given reading is CORRECT (that's a human/reviewer job -- DESIGN.md's
// whole "寧可保守標記" ethos), only that the file is internally consistent
// and every reading is at least well-formed kana `kanaToCells` accepts.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { kanaToCells } from "../../src/lib/kana";
import { POS_VALUES } from "../../src/lib/bank/types";

interface FrequencyWord {
  rank: number;
  surface: string;
  reading: string;
  gloss: string;
  pos: string;
}

const raw = readFileSync(new URL("../../data/frequency/n5.json", import.meta.url), "utf8");
const freq = JSON.parse(raw) as { source: string; words: FrequencyWord[] };

// The 30 already-published words (data/words/2026-09-10..12.json), which
// the frequency table must also list -- DESIGN.md's own generate-daily
// pipeline picking logic SKIPS words already in data/words/*.json, so they
// must still occupy their rank in the table rather than being left out.
const EXISTING_30: Array<[string, string]> = [
  ["私", "わたし"], ["人", "ひと"], ["今日", "きょう"], ["明日", "あした"], ["学校", "がっこう"],
  ["先生", "せんせい"], ["学生", "がくせい"], ["行く", "いく"], ["来る", "くる"], ["見る", "みる"],
  ["食べる", "たべる"], ["飲む", "のむ"], ["時間", "じかん"], ["水", "みず"], ["日本", "にほん"],
  ["大きい", "おおきい"], ["小さい", "ちいさい"], ["新しい", "あたらしい"], ["好き", "すき"], ["本", "ほん"],
  ["友達", "ともだち"], ["家", "いえ"], ["電車", "でんしゃ"], ["駅", "えき"], ["お金", "おかね"],
  ["朝", "あさ"], ["今", "いま"], ["何", "なに"], ["これ", "これ"], ["ありがとう", "ありがとう"],
];

describe("data/frequency/n5.json", () => {
  it("has a source label and a non-trivially-sized word list", () => {
    expect(freq.source).toBeTypeOf("string");
    expect(freq.source.length).toBeGreaterThan(0);
    expect(freq.words.length).toBeGreaterThanOrEqual(250);
  });

  it("rank is 1-indexed and strictly sequential (no gaps, no duplicates)", () => {
    freq.words.forEach((w, i) => {
      expect(w.rank).toBe(i + 1);
    });
  });

  it("surface+reading is unique across the whole table", () => {
    const seen = new Set<string>();
    for (const w of freq.words) {
      const key = `${w.surface}|${w.reading}`;
      expect(seen.has(key), `duplicate surface+reading: ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it("pos is always one of POS_VALUES", () => {
    for (const w of freq.words) {
      expect(POS_VALUES as readonly string[], `bad pos "${w.pos}" for ${w.surface}`).toContain(w.pos);
    }
  });

  it("every reading is kana kanaToCells accepts, with no out-of-table mora", () => {
    for (const w of freq.words) {
      let morae: ReturnType<typeof kanaToCells> | undefined;
      expect(() => {
        morae = kanaToCells(w.reading);
      }, `reading "${w.reading}" for ${w.surface} (rank ${w.rank}) threw`).not.toThrow();
      const outOfTable = morae!.find((m) => m.marks.includes("out_of_table"));
      expect(outOfTable, `reading "${w.reading}" for ${w.surface} has out-of-table mora`).toBeUndefined();
    }
  });

  it("every gloss is non-empty", () => {
    for (const w of freq.words) {
      expect(w.gloss.length, `empty gloss for ${w.surface}`).toBeGreaterThan(0);
    }
  });

  it("all 30 already-published words (data/words/2026-09-10..12.json) are present at some rank", () => {
    const bySurfaceReading = new Map(freq.words.map((w) => [`${w.surface}|${w.reading}`, w]));
    for (const [surface, reading] of EXISTING_30) {
      expect(bySurfaceReading.has(`${surface}|${reading}`), `missing ${surface}/${reading}`).toBe(true);
    }
  });

  it("those 30 words occupy ranks 1-30 in the same order data/words/*.json's own freq_rank uses", () => {
    EXISTING_30.forEach(([surface, reading], i) => {
      const w = freq.words[i];
      expect(w.rank).toBe(i + 1);
      expect(w.surface).toBe(surface);
      expect(w.reading).toBe(reading);
    });
  });
});
