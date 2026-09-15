// scripts/__tests__/generate-daily.test.ts — build task 2026-09 step 6.
// Exercises the pure functions scripts/generate-daily.ts exports
// (pickNextWords/assembleSeed/applyJudgments/canPromote/parseArgs/
// resolveEnricher/resolveJudge) directly, with no filesystem or real AI
// call involved -- FileEnricher fixtures below use a temp file so even
// those stay off the repo's own data/ directories.

import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JudgeResult } from "../lib/ai/judge";
import type { EnrichResult } from "../lib/ai/enricher";
import { FileEnricher } from "../lib/ai/file";
import { StubEnricher, StubJudge } from "../lib/ai/stub";
import { enrichWord, BuildError, WORDS_PER_DAY } from "../lib/validate-words";
import {
  applyJudgments,
  assembleSeed,
  canPromote,
  parseArgs,
  pickNextWords,
  resolveEnricher,
  resolveJudge,
  type FrequencyWord,
} from "../generate-daily";

const FREQ: FrequencyWord[] = [
  { rank: 1, surface: "私", reading: "わたし", gloss: "我", pos: "代名詞" },
  { rank: 2, surface: "人", reading: "ひと", gloss: "人", pos: "名詞" },
  { rank: 3, surface: "今日", reading: "きょう", gloss: "今天", pos: "名詞" },
  { rank: 4, surface: "話す", reading: "はなす", gloss: "說話", pos: "動詞" },
  { rank: 5, surface: "とても", reading: "とても", gloss: "非常", pos: "副詞" },
];

describe("pickNextWords", () => {
  it("skips surface+reading already in existingKeys, keeps rank order", () => {
    const existing = new Set(["私|わたし"]);
    const picked = pickNextWords(FREQ, existing, 3);
    expect(picked.map((w) => w.surface)).toEqual(["人", "今日", "話す"]);
  });

  it("throws (not a silently short list) when the table runs out", () => {
    expect(() => pickNextWords(FREQ, new Set(), 10)).toThrow(/剩餘可用詞不足/);
  });

  it("returns an empty array for count 0 without throwing", () => {
    expect(pickNextWords(FREQ, new Set(), 0)).toEqual([]);
  });
});

describe("assembleSeed", () => {
  const enriched: EnrichResult = {
    example: { ja: "話します。", zh: "說話。", tokens: [{ surface: "話します", reading: "はなします", gloss: "說話" }] },
    collocations: ["日本語を話す"],
    note: "ます形",
  };

  it("carries the frequency word's fields through, and always starts verified:false", () => {
    const seed = assembleSeed(FREQ[3], enriched, "w_0999");
    expect(seed.id).toBe("w_0999");
    expect(seed.surface).toBe("話す");
    expect(seed.reading).toBe("はなす");
    expect(seed.freq_rank).toBe(4);
    expect(seed.level).toBe("N5");
    expect(seed.source).toBe("n5-freq");
    expect(seed.verified).toBe(false);
    expect(seed.example).toEqual(enriched.example);
    expect(seed.collocations).toEqual(["日本語を話す"]);
    expect(seed.note).toBe("ます形");
    expect(seed.confusable_with).toEqual([]);
    expect(seed.romaji_override).toBeNull();
  });
});

describe("applyJudgments", () => {
  const seed = assembleSeed(
    FREQ[0],
    { example: { ja: "私です。", zh: "我。", tokens: [{ surface: "私", reading: "わたし", gloss: "我" }] }, collocations: [], note: null },
    "w_0001",
  );

  it("verified:true only when the judgment is fully clean", () => {
    const clean: JudgeResult = { natural: true, reading_ok: true, gloss_ok: true, issues: [] };
    const [word] = applyJudgments([seed], { w_0001: clean });
    expect(word.verified).toBe(true);
  });

  it("verified:false when any flag is false", () => {
    const bad: JudgeResult = { natural: false, reading_ok: true, gloss_ok: true, issues: ["不自然"] };
    const [word] = applyJudgments([seed], { w_0001: bad });
    expect(word.verified).toBe(false);
  });

  it("verified:false when flags are all true but issues is non-empty", () => {
    const flaggedAnyway: JudgeResult = { natural: true, reading_ok: true, gloss_ok: true, issues: ["備註"] };
    const [word] = applyJudgments([seed], { w_0001: flaggedAnyway });
    expect(word.verified).toBe(false);
  });

  it("verified:false when there's no judgment at all for this word", () => {
    const [word] = applyJudgments([seed], {});
    expect(word.verified).toBe(false);
  });
});

describe("canPromote", () => {
  it("true iff exactly WORDS_PER_DAY words, all verified", () => {
    const words = Array.from({ length: WORDS_PER_DAY }, (_, i) =>
      assembleSeed(FREQ[0], { example: { ja: "x。", zh: "x", tokens: [{ surface: "x", reading: "x", gloss: "（測試）" }] }, collocations: [], note: null }, `w_a${i}`),
    ).map((w) => ({ ...w, verified: true }));
    expect(canPromote(words)).toBe(true);
  });

  it("false when one word isn't verified", () => {
    const words = Array.from({ length: WORDS_PER_DAY }, (_, i) =>
      assembleSeed(FREQ[0], { example: { ja: "x。", zh: "x", tokens: [{ surface: "x", reading: "x", gloss: "（測試）" }] }, collocations: [], note: null }, `w_b${i}`),
    ).map((w, i) => ({ ...w, verified: i !== 0 }));
    expect(canPromote(words)).toBe(false);
  });

  it("false when the count isn't exactly WORDS_PER_DAY", () => {
    const words = Array.from({ length: WORDS_PER_DAY - 1 }, (_, i) =>
      assembleSeed(FREQ[0], { example: { ja: "x。", zh: "x", tokens: [{ surface: "x", reading: "x", gloss: "（測試）" }] }, collocations: [], note: null }, `w_c${i}`),
    ).map((w) => ({ ...w, verified: true }));
    expect(canPromote(words)).toBe(false);
  });
});

describe("parseArgs", () => {
  it("defaults: stub/stub, no promote, no dry-run, no force", () => {
    const args = parseArgs([]);
    expect(args.enricher).toBe("stub");
    expect(args.judge).toBe("stub");
    expect(args.promote).toBe(false);
    expect(args.dryRun).toBe(false);
    expect(args.force).toBe(false);
    expect(args.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("parses every flag", () => {
    const args = parseArgs([
      "--date", "2026-09-14",
      "--enricher", "file:/tmp/x.json",
      "--judge", "claude",
      "--promote",
      "--dry-run",
      "--force",
    ]);
    expect(args).toEqual({
      date: "2026-09-14",
      enricher: "file:/tmp/x.json",
      judge: "claude",
      promote: true,
      dryRun: true,
      force: true,
    });
  });

  it("no longer accepts --count (review item 6: removed, WORDS_PER_DAY is fixed everywhere else)", () => {
    expect(() => parseArgs(["--count", "5"])).toThrow(/未知的參數/);
  });

  it("rejects an unknown flag", () => {
    expect(() => parseArgs(["--wat"])).toThrow(/未知的參數/);
  });
});

describe("resolveEnricher / resolveJudge -- claude is loaded ONLY when requested", () => {
  it("stub never touches the claude loader", async () => {
    const loaders = {
      loadClaudeEnricher: () => {
        throw new Error("should not be called for stub");
      },
    };
    const enricher = await resolveEnricher("stub", loaders);
    expect(enricher).toBe(StubEnricher);
  });

  it("file: never touches the claude loader", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nk-test-"));
    const path = join(dir, "fixture.json");
    writeFileSync(path, "{}");
    const loaders = {
      loadClaudeEnricher: () => {
        throw new Error("should not be called for file:");
      },
    };
    const enricher = await resolveEnricher(`file:${path}`, loaders);
    expect(enricher.name).toBe(`file:${path}`);
  });

  it("claude DOES call the injected loader (proves the wiring, without touching @anthropic-ai/sdk)", async () => {
    const fakeEnricher = { name: "fake-claude", enrich: async () => ({ example: { ja: "", zh: "", tokens: [] }, collocations: [], note: null }) };
    let called = false;
    const enricher = await resolveEnricher("claude", {
      loadClaudeEnricher: async () => {
        called = true;
        return fakeEnricher;
      },
    });
    expect(called).toBe(true);
    expect(enricher).toBe(fakeEnricher);
  });

  it("resolveJudge: stub never touches the claude loader", async () => {
    const judge = await resolveJudge("stub", {
      loadClaudeJudge: () => {
        throw new Error("should not be called for stub");
      },
    });
    expect(judge).toBe(StubJudge);
  });

  it("unknown spec throws a clear error", async () => {
    await expect(resolveEnricher("bogus")).rejects.toThrow(/未知的 --enricher/);
    await expect(resolveJudge("bogus")).rejects.toThrow(/未知的 --judge/);
  });
});

describe("FileEnricher bad output is caught by enrichWord's own validation (same checks build-bank.ts/validate-words.ts always ran)", () => {
  function writeFixture(entries: Record<string, EnrichResult>): string {
    const dir = mkdtempSync(join(tmpdir(), "nk-test-"));
    const path = join(dir, "fixture.json");
    writeFileSync(path, JSON.stringify(entries), "utf8");
    return path;
  }

  it("reading 含漢字 被抓", async () => {
    const path = writeFixture({
      "会社|かいしゃ": {
        example: { ja: "会社です。", zh: "公司。", tokens: [{ surface: "会社", reading: "会社", gloss: "公司" }, { surface: "です", reading: "です", gloss: "是" }] },
        collocations: [],
        note: null,
      },
    });
    const enricher = FileEnricher(path);
    const result = await enricher.enrich({
      surface: "会社", reading: "かいしゃ", gloss: "公司", pos: "名詞", level: "N5", existing_surfaces: [],
    });
    const seed = assembleSeed(
      { rank: 99, surface: "会社", reading: "かいしゃ", gloss: "公司", pos: "名詞" },
      result,
      "w_9001",
    );
    expect(() => enrichWord(seed, "fixture.json")).toThrow(BuildError);
    expect(() => enrichWord(seed, "fixture.json")).toThrow(/example\.tokens\[0\]\.reading 含非假名字元/);
  });

  it("particle 誤標（を 未標 particle:true）被抓", async () => {
    const path = writeFixture({
      "これ|これ": {
        example: {
          ja: "水を飲みます。",
          zh: "喝水。",
          tokens: [
            { surface: "水", reading: "みず", gloss: "水" },
            { surface: "を", reading: "を", gloss: "（受詞）" }, // missing particle: true
            { surface: "飲みます", reading: "のみます", gloss: "喝" },
          ],
        },
        collocations: [],
        note: null,
      },
    });
    const enricher = FileEnricher(path);
    const result = await enricher.enrich({
      surface: "これ", reading: "これ", gloss: "這個", pos: "代名詞", level: "N5", existing_surfaces: [],
    });
    const seed = assembleSeed({ rank: 99, surface: "これ", reading: "これ", gloss: "這個", pos: "代名詞" }, result, "w_9002");
    expect(() => enrichWord(seed, "fixture.json")).toThrow(/幾乎必為助詞，但未標 particle:true/);
  });

  it("ja 與 tokens 不符 被抓", async () => {
    const path = writeFixture({
      "話す|はなす": {
        example: {
          ja: "日本語を話します。", // doesn't match tokens below at all
          zh: "說日語。",
          tokens: [{ surface: "話します", reading: "はなします", gloss: "說話" }],
        },
        collocations: [],
        note: null,
      },
    });
    const enricher = FileEnricher(path);
    const result = await enricher.enrich({
      surface: "話す", reading: "はなす", gloss: "說話", pos: "動詞", level: "N5", existing_surfaces: [],
    });
    const seed = assembleSeed({ rank: 99, surface: "話す", reading: "はなす", gloss: "說話", pos: "動詞" }, result, "w_9003");
    expect(() => enrichWord(seed, "fixture.json")).toThrow(/example\.ja 與 tokens 串接不一致/);
  });

  it("找不到預錄結果時 FileEnricher 直接 throw（不靜默 fallback）", async () => {
    const path = writeFixture({});
    const enricher = FileEnricher(path);
    await expect(
      enricher.enrich({ surface: "未知", reading: "みち", gloss: "?", pos: "名詞", level: "N5", existing_surfaces: [] }),
    ).rejects.toThrow(/找不到/);
  });
});

describe("StubEnricher example tokens carry gloss (DESIGN.md §8.2)", () => {
  it("noun template: headword token uses the word's own gloss, です is 是; passes enrichWord's gloss checks", async () => {
    const result = await StubEnricher.enrich({ surface: "人", reading: "ひと", gloss: "人", pos: "名詞", level: "N5", existing_surfaces: [] });
    expect(result.example.tokens).toEqual([
      { surface: "人", reading: "ひと", gloss: "人" },
      { surface: "です", reading: "です", gloss: "是" },
    ]);
    const seed = assembleSeed(FREQ[1], result, "w_9101");
    expect(() => enrichWord(seed, "stub.json")).not.toThrow();
  });

  it("verb template: the single token uses the word's own gloss", async () => {
    const result = await StubEnricher.enrich({ surface: "話す", reading: "はなす", gloss: "說話", pos: "動詞", level: "N5", existing_surfaces: [] });
    expect(result.example.tokens).toEqual([{ surface: "話す", reading: "はなす", gloss: "說話" }]);
  });
});
