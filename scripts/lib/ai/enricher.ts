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
}
