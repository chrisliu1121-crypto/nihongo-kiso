// scripts/__tests__/pending.test.ts — build task 2026-09 review item 8:
// direct coverage for scripts/lib/pending.ts's pure helpers, which were
// previously only exercised indirectly through generate-daily.ts/
// cross-check.ts's own CLI flows.

import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WordSeed } from "../../src/lib/bank/types";
import {
  buildWordCtx,
  collectExistingExampleSurfaces,
  fileExists,
  flattenWords,
  nextWordIds,
  type PendingDayFile,
} from "../lib/pending";
import type { RawDay } from "../lib/validate-words";

const BASE_EXAMPLE: WordSeed["example"] = {
  ja: "これです。",
  zh: "是這個。",
  tokens: [
    { surface: "これ", reading: "これ", gloss: "這" },
    { surface: "です", reading: "です", gloss: "是" },
  ],
};

function makeWord(overrides: Partial<WordSeed> = {}): WordSeed {
  return {
    id: "w_0001",
    surface: "学校",
    reading: "がっこう",
    gloss: "學校",
    pos: "名詞",
    level: "N5",
    freq_rank: 1,
    romaji_override: null,
    example: BASE_EXAMPLE,
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
  return { file, seed: { date: file.replace(/\.json$/, ""), words } };
}

describe("flattenWords", () => {
  it("flattens words across multiple days, earliest day first", () => {
    const days: RawDay[] = [
      makeDay("2026-01-01.json", [makeWord({ id: "w_0001" }), makeWord({ id: "w_0002" })]),
      makeDay("2026-01-02.json", [makeWord({ id: "w_0003" })]),
    ];
    expect(flattenWords(days).map((w) => w.id)).toEqual(["w_0001", "w_0002", "w_0003"]);
  });

  it("returns an empty array for an empty day list", () => {
    expect(flattenWords([])).toEqual([]);
  });
});

describe("nextWordIds", () => {
  it("continues from the highest existing w_NNNN id", () => {
    const days: RawDay[] = [makeDay("2026-01-01.json", [makeWord({ id: "w_0007" }), makeWord({ id: "w_0003" })])];
    expect(nextWordIds(days, 3)).toEqual(["w_0008", "w_0009", "w_0010"]);
  });

  it("does NOT backfill a gap left by a deleted/skipped id -- always continues from the max (see pending.ts's own doc comment for why)", () => {
    // w_0005 is "missing" (deleted, or never existed) between 0001 and 0009.
    const days: RawDay[] = [makeDay("2026-01-01.json", [makeWord({ id: "w_0001" }), makeWord({ id: "w_0009" })])];
    const ids = nextWordIds(days, 2);
    expect(ids).toEqual(["w_0010", "w_0011"]);
    expect(ids).not.toContain("w_0005");
  });

  it("starts from w_0001 when the bank is empty", () => {
    expect(nextWordIds([], 2)).toEqual(["w_0001", "w_0002"]);
  });
});

describe("buildWordCtx", () => {
  const days: RawDay[] = [
    makeDay("2026-01-01.json", [
      makeWord({ id: "w_0001", surface: "学校", reading: "がっこう", freq_rank: 5, confusable_with: ["w_0002"] }),
      makeWord({ id: "w_0002", surface: "行く", reading: "いく", freq_rank: 8, confusable_with: ["w_0001"] }),
    ]),
  ];

  it("collects existing ids/surface+reading/freq_rank from every day", () => {
    const ctx = buildWordCtx(days, []);
    expect(ctx.existingIds).toEqual(new Set(["w_0001", "w_0002"]));
    expect(ctx.existingSurfaceReading).toEqual(new Set(["学校|がっこう", "行く|いく"]));
    expect(ctx.existingFreqRanks).toEqual(new Set([5, 8]));
    expect(ctx.existingConfusableWith?.get("w_0001")).toEqual(["w_0002"]);
  });

  it("knownKanji is the union of frequency-table surfaces and existing words' own surfaces", () => {
    const ctx = buildWordCtx(days, ["日本語", "犬"]);
    // from freqSurfaces: 日,本,語 / 犬 -- from existing words' own surface: 学,校 / 行
    for (const kanji of ["日", "本", "語", "犬", "学", "校", "行"]) {
      expect(ctx.knownKanji.has(kanji), `missing ${kanji}`).toBe(true);
    }
    expect(ctx.knownKanji.has("猫")).toBe(false);
  });

  it("existingExampleJa maps each existing word's example.ja to its own id", () => {
    const ctx = buildWordCtx(days, []);
    expect(ctx.existingExampleJa.get(BASE_EXAMPLE.ja)).toBe("w_0002"); // last word wins the map key -- both share BASE_EXAMPLE here
  });

  it("empty existingDays -> every ctx field is empty, not undefined/throwing", () => {
    const ctx = buildWordCtx([], ["日本語"]);
    expect(ctx.existingIds.size).toBe(0);
    expect(ctx.existingSurfaceReading.size).toBe(0);
    expect(ctx.existingFreqRanks.size).toBe(0);
    expect(ctx.existingExampleJa.size).toBe(0);
    expect(ctx.knownKanji.has("日")).toBe(true); // still picks up freqSurfaces even with no existing words
  });
});

describe("collectExistingExampleSurfaces", () => {
  it("collects every token surface across every existing word's example, deduped", () => {
    const days: RawDay[] = [
      makeDay("2026-01-01.json", [
        makeWord({
          id: "w_0001",
          example: { ja: "水を飲みます。", zh: "喝水。", tokens: [{ surface: "水", reading: "みず", gloss: "水" }, { surface: "を", reading: "を", gloss: "（受詞）", particle: true }, { surface: "飲みます", reading: "のみます", gloss: "喝" }] },
        }),
        makeWord({
          id: "w_0002",
          example: { ja: "水です。", zh: "是水。", tokens: [{ surface: "水", reading: "みず", gloss: "水" }, { surface: "です", reading: "です", gloss: "是" }] },
        }),
      ]),
    ];
    const surfaces = collectExistingExampleSurfaces(days);
    expect(new Set(surfaces)).toEqual(new Set(["水", "を", "飲みます", "です"]));
  });

  it("returns an empty array when there are no existing days", () => {
    expect(collectExistingExampleSurfaces([])).toEqual([]);
  });
});

describe("fileExists (review items 1/2: the pre-flight checks generate-daily.ts's main() runs before ever writing anything)", () => {
  it("true for a file that exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "nk-test-"));
    const path = join(dir, "x.json");
    writeFileSync(path, "{}");
    return fileExists(path).then((exists) => expect(exists).toBe(true));
  });

  it("false for a path that doesn't exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "nk-test-"));
    return fileExists(join(dir, "nope.json")).then((exists) => expect(exists).toBe(false));
  });
});

// Type-only sanity check that PendingDayFile really does extend DaySeed
// with a `pipeline` field -- keeps this test file honest about the shape
// it's asserting on above.
const _typeCheck: PendingDayFile = {
  date: "2026-01-01",
  words: [],
  pipeline: { enricher: "stub", judge: "stub", generated_at: "", judgments: {} },
};
void _typeCheck;
