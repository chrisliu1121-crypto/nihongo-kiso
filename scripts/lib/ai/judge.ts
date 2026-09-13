// scripts/lib/ai/judge.ts — pluggable second-opinion checker for one
// Enricher output (DESIGN.md §9.1/§9.3: AI 產出必須先進 pending、通過程式
// 驗證、再經第二個獨立判讀一致，才進 data/words/). A Judge is deliberately
// NOT told the first pass's reasoning -- it only ever sees the word and the
// candidate example, and forms its own opinion (§9.3 "第二次呼叫不提供第一
// 次的理由，只給句子與候選，獨立判讀").
//
// The same interface is reused (unchanged) for scripts/cross-check.ts,
// which re-runs this step against an existing data/pending/*.json entry --
// DESIGN.md §9.1 calls this "cross-check", not a different mechanism.

import type { EnrichResult } from "./enricher.ts";

/** Everything a Judge needs to independently assess one enriched candidate. No first-pass reasoning included, by design (see file header). */
export interface JudgeRequest {
  surface: string;
  reading: string;
  gloss: string;
  example: EnrichResult["example"];
  /** Every example.ja sentence already published elsewhere in the bank (build task 2026-09 review item 9) -- lets a Judge flag a candidate that's grammatically fine on its own but reads as a near-duplicate of something already in data/words/. */
  existing_examples: string[];
}

export interface JudgeResult {
  natural: boolean;
  reading_ok: boolean;
  gloss_ok: boolean;
  /** Human/AI-readable reasons for any false verdict above; empty when everything passed. */
  issues: string[];
}

/** A pluggable second-opinion backend. `name` is surfaced in pipeline metadata (data/pending/*.json's `pipeline.judge`) and CLI output. */
export interface Judge {
  name: string;
  judge(req: JudgeRequest): Promise<JudgeResult>;
}
