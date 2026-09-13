// scripts/lib/ai/stub.ts — deterministic, offline Enricher/Judge (build task
// 2026-09 step 6). This machine has no Claude API key, and the whole content
// pipeline must be runnable and testable without one (DESIGN.md §9's "AI 呼叫
// 是可插拔介面" principle exists specifically so this is possible) -- StubEnricher
// exists to prove the pipeline (validate -> judge -> promote) works end to
// end, NOT to produce real teaching content. Its examples are deliberately
// the most conservative sentence a word's part of speech allows, and are
// never meant to be promoted into data/words/ as real content (see
// generate-daily.test.ts / the build task's acceptance step 4, which
// deletes a stub-generated day file after proving --promote works).

import type { Enricher, EnrichRequest, EnrichResult } from "./enricher.ts";
import type { Judge, JudgeRequest, JudgeResult } from "./judge.ts";

const COPULA = { surface: "です", reading: "です" };

/** Build the single most conservative example a POS allows: nouns/pronouns/question-words/adjectives get "{surface}です。"; verbs/adverbs/expressions get just the bare predicate "{surface}。" (there's no safe generic way to build a full sentence around an arbitrary verb without knowing its conjugation class). */
function buildExample(req: EnrichRequest): EnrichResult["example"] {
  const headToken = { surface: req.surface, reading: req.reading };

  switch (req.pos) {
    case "名詞":
    case "代名詞":
    case "疑問詞":
    case "い形容詞":
    case "な形容詞":
      return {
        ja: `${req.surface}です。`,
        zh: req.gloss,
        tokens: [headToken, COPULA],
      };
    case "動詞":
    case "副詞":
    case "表現":
      return {
        ja: `${req.surface}。`,
        zh: req.gloss,
        tokens: [headToken],
      };
    default: {
      // Exhaustiveness guard: PartOfSpeech is a closed union (POS_VALUES) --
      // a new pos added there without updating this switch should fail loud
      // at compile time, not silently fall through to a guessed template.
      const exhaustive: never = req.pos;
      throw new Error(`StubEnricher: 未知的 pos：${exhaustive as string}`);
    }
  }
}

/**
 * Deterministic, offline Enricher (DESIGN.md §9 "AI 呼叫是可插拔介面" --
 * this is the default backend so the whole generate-daily pipeline runs
 * with no API key). Produces the most conservative example a word's pos
 * allows; empty collocations; no note. Not real content -- see file header.
 */
export const StubEnricher: Enricher = {
  name: "stub",
  async enrich(req: EnrichRequest): Promise<EnrichResult> {
    return {
      example: buildExample(req),
      collocations: [],
      note: null,
    };
  },
};

/** Deterministic, offline Judge that always agrees -- pairs with StubEnricher to let the whole validate -> judge -> promote pipeline run with no API key (DESIGN.md §9). */
export const StubJudge: Judge = {
  name: "stub",
  async judge(_req: JudgeRequest): Promise<JudgeResult> {
    return { natural: true, reading_ok: true, gloss_ok: true, issues: [] };
  },
};
