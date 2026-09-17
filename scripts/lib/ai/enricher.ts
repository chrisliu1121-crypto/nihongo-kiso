// scripts/lib/ai/enricher.ts — pluggable "how to say it" content generator
// (DESIGN.md §9: "骨架固定，AI 填內容。AI 不決定學什麼，只決定怎麼講"). The
// frequency table decides WHICH word comes next; an Enricher only decides
// its example sentence, collocations, and note. Three implementations share
// this one interface (stub.ts / file.ts / claude.ts) so generate-daily.ts
// never has to know or care which one it's calling.

import type { PartOfSpeech } from "../../../src/lib/bank/types.ts";

/** Everything an Enricher needs to know about the word it's enriching. */
export interface EnrichRequest {
  surface: string;
  reading: string;
  gloss: string;
  pos: PartOfSpeech;
  level: string;
  /** Surfaces already used in OTHER words' example sentences in this bank, so an enricher (especially an AI one) can avoid producing a near-duplicate example. */
  existing_surfaces: string[];
  /**
   * 2026-09-17 "卡死" fix (DESIGN.md §9.1 "逐詞重試與替補"): every kanji
   * character the example is ALLOWED to use in a non-particle token's
   * surface (buildKnownKanji's output, concatenated into one string) --
   * without this, an AI enricher has no way to know 号/答/枚 etc. are out of
   * scope until validateWordStandalone rejects the word after the fact.
   * Optional (not every caller of EnrichRequest -- older tests, stub.ts --
   * has a knownKanji set to hand); providers treat an absent/empty value as
   * "no restriction stated" and fall back to their base instructions alone.
   */
  allowed_kanji?: string;
  /**
   * Every problem the PREVIOUS attempt at this same word had (from
   * validateWordStandalone or a Judge's `issues`), so a retried enrich()
   * call can be told exactly what to fix instead of blindly trying again --
   * the root cause of the 2026-09-16/17 failure: a rejected word was
   * regenerated from scratch the next day with zero memory of why it was
   * rejected, and made the exact same mistake again. Empty/absent on a
   * word's first attempt.
   */
  feedback?: string[];
}

/** One example-sentence token, author-seed shaped (DESIGN.md §8.2 WordExampleSeed/ExampleToken) -- no derived morae/romaji here, build-bank.ts computes those. */
export interface EnrichResultToken {
  surface: string;
  reading: string;
  /** Traditional-Chinese meaning of this token in this sentence; particles use a parenthesized function label ("（主題）"). Required -- see ExampleToken.gloss. */
  gloss: string;
  particle?: boolean;
}

export interface EnrichResult {
  example: {
    ja: string;
    zh: string;
    tokens: EnrichResultToken[];
  };
  collocations: string[];
  note: string | null;
}

/** A pluggable "fill in the content" backend. `name` is surfaced in pipeline metadata (data/pending/*.json's `pipeline.enricher`) and CLI output. */
export interface Enricher {
  name: string;
  enrich(req: EnrichRequest): Promise<EnrichResult>;
  /**
   * 2026-09-18 P1 fix: optional cumulative count of actual HTTP requests
   * made so far across every enrich() call on this instance, INCLUDING
   * backoff retries (openrouter.ts's own -- see that file's header comment
   * on RETRYABLE_STATUSES). Only openrouter.ts implements this; stub/file/
   * claude never retry at this layer, so their logical call count already
   * IS their true request count and they leave this undefined. Consumed by
   * generate-daily.ts's step-summary AI-call-count line, which prefers this
   * over its own logical per-word counter when present, specifically so
   * that number is "誠實" about retries instead of undercounting them.
   */
  requestCount?(): number;
}
