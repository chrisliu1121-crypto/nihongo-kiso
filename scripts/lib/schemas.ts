// scripts/lib/schemas.ts — zod schemas for the shapes that cross a
// trust boundary (build task 2026-09 review item 3, DESIGN.md §9.2 "JSON
// schema（zod）"):
//   - WordSeedSchema/WordFileSchema: what validateWordFile's FIRST step runs
//     against a candidate data/pending/*.json (or data/words/*.json) day --
//     catches shape problems (missing field, wrong type) with a clear
//     BuildError instead of a TypeError three functions later.
//   - EnrichResultSchema/JudgeResultSchema: what scripts/lib/ai/claude.ts
//     runs the model's structured-output JSON through before trusting it.
//
// These are intentionally NOT the single source of truth for the
// TypeScript types in src/lib/bank/types.ts / scripts/lib/ai/{enricher,judge}.ts
// -- they're a runtime re-statement of the same shape, used only at the
// trust boundary (parsed JSON from disk or from the model). Keep them in
// sync by hand when those types change; z.infer isn't used as the type
// source because src/lib/bank/types.ts predates this file and is imported
// in many places that have nothing to do with runtime validation.

import { z } from "zod";
import { GRAMMAR_CATEGORY_VALUES, GRAMMAR_WEIGHT_VALUES, POS_VALUES } from "../../src/lib/bank/types.ts";

const LEVEL_VALUES = ["N5", "N4", "N3", "N2", "N1"] as const;

export const ExampleTokenSchema = z.object({
  surface: z.string(),
  reading: z.string(),
  gloss: z.string(),
  particle: z.boolean().optional(),
});

export const WordSeedSchema = z.object({
  id: z.string(),
  surface: z.string(),
  reading: z.string(),
  gloss: z.string(),
  pos: z.enum(POS_VALUES),
  level: z.enum(LEVEL_VALUES),
  freq_rank: z.number(),
  romaji_override: z.string().nullable(),
  example: z.object({
    ja: z.string(),
    zh: z.string(),
    tokens: z.array(ExampleTokenSchema),
  }),
  collocations: z.array(z.string()),
  confusable_with: z.array(z.string()),
  note: z.string().nullable(),
  pitch: z.number().nullable(),
  audio: z.string().nullable(),
  source: z.string(),
  verified: z.boolean(),
});

/** Shape of one data/words/YYYY-MM-DD.json (or data/pending/YYYY-MM-DD.json) day file. Doesn't enforce the exactly-10-words rule -- that's validateWordFile/validateWordSet's own procedural check (WORDS_PER_DAY), kept separate so a schema failure and a count failure read as distinct BuildError reasons. */
export const WordFileSchema = z.object({
  date: z.string(),
  words: z.array(WordSeedSchema),
});

// ---------------------------------------------------------------------------
// AI response shapes (scripts/lib/ai/claude.ts). `particle` is required-but-
// nullable rather than optional: some structured-output implementations
// (including the json_schema output_config this repo uses) require every
// property named in a strict schema's `properties` to also appear in
// `required`, so an optional field has to be modeled as "always present,
// possibly null" instead of "sometimes absent" (review item 3).

export const EnrichResultTokenSchema = z.object({
  surface: z.string(),
  reading: z.string(),
  gloss: z.string(),
  particle: z.boolean().nullable(),
});

export const EnrichResultSchema = z.object({
  example: z.object({
    ja: z.string(),
    zh: z.string(),
    tokens: z.array(EnrichResultTokenSchema),
  }),
  collocations: z.array(z.string()),
  note: z.string().nullable(),
});

export const JudgeResultSchema = z.object({
  natural: z.boolean(),
  reading_ok: z.boolean(),
  gloss_ok: z.boolean(),
  issues: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Grammar items (build task 2026-09-24 §A: "build-bank 驗證 items：zod
// schema..."). Shape-only checks here; the semantic checks (id uniqueness/
// slug format, example_ids/contrast_with referencing something real, cell
// within the 46-cell set) live in build-bank.ts's own validateGrammarItems,
// same split as WordSeedSchema (shape) vs enrichWord (semantics).

export const GrammarSenseSchema = z.object({
  label: z.string(),
  explanation: z.string(),
  example_ids: z.array(z.string()),
});

export const GrammarItemSchema = z.object({
  id: z.string(),
  surface: z.string(),
  reading: z.string(),
  category: z.enum(GRAMMAR_CATEGORY_VALUES),
  pattern: z.string().optional(),
  core: z.string(),
  zh_bridge: z.string().optional(),
  senses: z.array(GrammarSenseSchema),
  contrast_with: z.array(z.string()).optional(),
  weight: z.enum(GRAMMAR_WEIGHT_VALUES).optional(),
  cell: z.string().optional(),
  notes: z.array(z.string()).optional(),
});

/** Shape of data/grammar/items.json. */
export const GrammarFileSchema = z.object({
  items: z.array(GrammarItemSchema),
});
