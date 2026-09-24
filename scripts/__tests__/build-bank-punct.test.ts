// scripts/__tests__/build-bank-punct.test.ts — 2026-09-24
// Punctuation tokens in sentence data: conjunction examples like
// 「りんごとみかん、そしてバナナを買いました」 read wrong without the comma, so a
// token whose surface is only punctuation is allowed with an empty reading
// and no gloss, contributes no romaji, and never counts as the predicate.

import { describe, expect, it } from "vitest";
import { DEFAULT_CODEC } from "../lib/validate-words";
import { BuildError, enrichSentence, isPunctuationSurface } from "../build-bank";
import type { SentenceSeed } from "../../src/lib/bank/types";

const seed = (tokens: SentenceSeed["tokens"]): SentenceSeed =>
  ({ id: "s_t001", pattern_id: null, level: "N5", tokens, translation: "t", verified: true }) as SentenceSeed;

describe("punctuation tokens", () => {
  it("isPunctuationSurface recognises Japanese/ASCII punctuation only", () => {
    for (const p of ["、", "。", "？", "！", "「", "」", "…"]) expect(isPunctuationSurface(p)).toBe(true);
    for (const w of ["そして", "で", "は", "ね"]) expect(isPunctuationSurface(w)).toBe(false);
  });

  it("keeps the comma in ja, adds no romaji, and does not need a gloss", () => {
    const s = enrichSentence(
      seed([
        { surface: "りんご", reading: "りんご", gloss: "蘋果" },
        { surface: "と", reading: "と", gloss: "（和）", particle: true },
        { surface: "みかん", reading: "みかん", gloss: "橘子" },
        { surface: "、", reading: "" } as SentenceSeed["tokens"][number],
        { surface: "そして", reading: "そして", gloss: "還有" },
        { surface: "バナナ", reading: "ばなな", gloss: "香蕉" },
        { surface: "を", reading: "を", gloss: "（受詞）", particle: true },
        { surface: "買いました", reading: "かいました", gloss: "買了" },
      ]),
      "t.json",
      DEFAULT_CODEC,
    );
    expect(s.ja).toBe("りんごとみかん、そしてバナナを買いました。");
    expect(s.romaji).toBe("ringo to mikan soshite banana o kaimashita");
    expect(s.tokens[3].morae).toEqual([]);
  });

  it("does not double a final 。 or ？ that is already a token", () => {
    const s = enrichSentence(
      seed([
        { surface: "行きます", reading: "いきます", gloss: "去" },
        { surface: "か", reading: "か", gloss: "（疑問）", particle: true },
        { surface: "？", reading: "" } as SentenceSeed["tokens"][number],
      ]),
      "t.json",
      DEFAULT_CODEC,
    );
    expect(s.ja).toBe("行きますか？");
  });

  it("rejects a punctuation token with a reading or a particle flag", () => {
    expect(() =>
      enrichSentence(seed([{ surface: "、", reading: "てん", gloss: "" }]), "t.json", DEFAULT_CODEC),
    ).toThrow(BuildError);
    expect(() =>
      enrichSentence(seed([{ surface: "、", reading: "", gloss: "", particle: true }]), "t.json", DEFAULT_CODEC),
    ).toThrow(BuildError);
  });
});
