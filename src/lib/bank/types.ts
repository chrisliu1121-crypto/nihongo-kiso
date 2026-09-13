// Types for the "今日單詞" daily word bank (build task 2026-09: 30 hand-seeded
// N5 words as the first real Token consumer, DESIGN.md §8.2/§12 step 3).
//
// Two shapes matter here:
//   - WordSeed / DaySeed: exactly what a human writes by hand in
//     data/words/YYYY-MM-DD.json. No computed fields -- morae/romaji/
//     romaji_ascii are derived, not authored (DESIGN.md §4 "build-time
//     budget everything").
//   - Word / DayEntry / Bank: what scripts/build-bank.ts produces into
//     data/bank.json after running every seed through kanaToCells /
//     readingToRomaji. This is what the app actually loads (src/lib/bank/index.ts).
//
// This intentionally does NOT reuse DESIGN.md §8.2's literal JSON example
// (which already bakes `morae`/`romaji`/`romaji_ascii` into the authored
// file, and uses a boolean `romaji_override` flag) -- the build task's own
// per-word schema is the authoritative one for this feature: computed
// fields live only in the built Word, and `romaji_override` is the literal
// replacement string (or null), not a flag.

import type { CellId, Mora } from "../kana/types.ts";
import type { Exercise } from "../exercise/types.ts";

/** Single source of truth for the pos enum -- scripts/build-bank.ts imports
 *  this array directly rather than keeping its own duplicate list. */
export const POS_VALUES = [
  "名詞",
  "動詞",
  "い形容詞",
  "な形容詞",
  "副詞",
  "代名詞",
  "疑問詞",
  "表現",
] as const;

export type PartOfSpeech = (typeof POS_VALUES)[number];

export type JlptLevel = "N5" | "N4" | "N3" | "N2" | "N1";

/**
 * One token inside an example sentence, authored by hand. Sentences are
 * tokenized (not fed to kanaToCells as one string) specifically so a
 * particle can be marked and converted on its own (DESIGN.md §7: は/へ/を
 * only read as wa/e/o when kanaToCells knows the token IS a particle) --
 * feeding a whole sentence through kanaToCells in one call can't make that
 * distinction, and separately, wrongly merges an unrelated word-boundary
 * vowel pair into a long vowel that was never one (e.g. お金"ga" + "あ"りません
 * getting read as "gā", a real bug this schema exists to avoid).
 */
export interface ExampleToken {
  surface: string;
  /** Kana-only reading of just this token. */
  reading: string;
  /** True for a grammatical particle token (は/が/を/に/で/と/の/も/へ/まで/...).
   *  Passed straight through to kanaToCells/readingToRomaji as `{ particle }`
   *  so は/へ/を read as wa/e/o; a no-op for every other particle. */
  particle?: boolean;
}

/** Author-facing example sentence: what a human writes. Punctuation ("。"/"、") lives only in `ja`, never inside a token's surface/reading. */
export interface WordExampleSeed {
  ja: string;
  zh: string;
  tokens: ExampleToken[];
}

/** One ExampleToken after build-bank.ts has run it through kanaToCells/readingToRomaji (with its own `particle` flag). */
export interface BuiltExampleToken extends ExampleToken {
  morae: Mora[];
  romaji: string;
}

/** Built example sentence. No sentence-wide `morae` -- each token already carries its own. */
export interface WordExample {
  ja: string;
  zh: string;
  tokens: BuiltExampleToken[];
  /** Every token's romaji, joined with a single space. */
  romaji: string;
}

/** Shape a human authors by hand in data/words/YYYY-MM-DD.json's `words` array. */
export interface WordSeed {
  /** Globally unique across the whole bank, e.g. "w_0001". */
  id: string;
  /** Displayed form, may include kanji. */
  surface: string;
  /** Kana-only reading (validated: must not throw kanaToCells). */
  reading: string;
  gloss: string;
  pos: PartOfSpeech;
  level: JlptLevel;
  /** Author's frequency estimate; only needs to be increasing within one day file. */
  freq_rank: number;
  /** Non-null replaces the derived `romaji` verbatim (romaji_ascii is still derived). */
  romaji_override: string | null;
  example: WordExampleSeed;
  collocations: string[];
  /** word ids of easily-confused words. */
  confusable_with: string[];
  note: string | null;
  /** Reserved: Tokyo-type pitch accent core position. Not populated in v1. */
  pitch: number | null;
  /** Reserved: audio file path. Not populated in v1. */
  audio: string | null;
  source: string;
  verified: boolean;
}

/** Shape of one data/words/YYYY-MM-DD.json file. */
export interface DaySeed {
  /** Must equal the filename (without ".json"). */
  date: string;
  words: WordSeed[];
}

/** A WordSeed after scripts/build-bank.ts has computed its derived fields. */
export interface Word extends Omit<WordSeed, "example"> {
  morae: Mora[];
  /** romaji_override when set, else derived from `reading`. */
  romaji: string;
  /** Always derived from `reading`, regardless of romaji_override. */
  romaji_ascii: string;
  example: WordExample;
}

/** One day inside the built data/bank.json. */
export interface DayEntry {
  date: string;
  words: Word[];
}

/** Shape of the built data/bank.json (gitignored; produced by `npm run build:bank`). */
export interface Bank {
  generated_at: string;
  days: DayEntry[];
  words: Word[];
  sentences: Sentence[];
  particles: ParticlesFile;
  /** Practice exercises (build task 2026-09 step 5, DESIGN.md §8.5). Unlike
   *  words/sentences, nothing here is computed at build time -- same
   *  validate-and-pass-through treatment as `particles` above. */
  exercises: Exercise[];
}

// ---------------------------------------------------------------------------
// Grammar sentences (build task 2026-09 step 4, DESIGN.md §8.3) -- same
// author-vs-built split as words above. A sentence feeds both the /grammar
// overview skeleton and the particle senses/contrast pairs; the same
// sentence id can be (and often is) referenced from more than one place, so
// sentences are stored once in data/sentences/*.json and referenced by id,
// never duplicated.

/**
 * One token inside a hand-authored sentence. Deliberately the same shape as
 * ExampleToken plus `gloss` -- sentences are tokenized for the exact same
 * reason word examples are (DESIGN.md §7: a particle's は/へ/を only read as
 * wa/e/o when kanaToCells is told this token IS a particle, and feeding a
 * whole sentence through kanaToCells at once can also misread an unrelated
 * word-boundary vowel pair as a long vowel).
 */
export interface SentenceToken {
  surface: string;
  /** Kana-only reading of just this token. */
  reading: string;
  /** Chinese gloss shown under this token; for a particle this names its function ("（主題）"), not a literal translation. */
  gloss: string;
  /** True for a grammatical particle token -- see ExampleToken's own doc for why this must be per-token. */
  particle?: boolean;
}

/** Author-facing shape: what a human writes in data/sentences/*.json's `sentences` array. */
export interface SentenceSeed {
  /** Globally unique across every data/sentences/*.json file, e.g. "s_g001". */
  id: string;
  /** Links to a data/patterns.json entry; null when this sentence isn't tied to one (patterns.json is out of this build task's scope). */
  pattern_id: string | null;
  level: JlptLevel;
  tokens: SentenceToken[];
  /**
   * 文節 (bunsetsu) partition of `tokens`, each entry a list of token
   * indices. Must cover every index in `tokens` exactly once -- this is the
   * arrange-practice block unit (DESIGN.md §8.3).
   */
  bunsetsu: number[][];
  /**
   * Natural word orders, each expressed as a permutation of *bunsetsu*
   * indices (not token indices). The verb-final bunsetsu must be last in
   * every order (build-bank.ts checks this: the last token of the last
   * bunsetsu must end in ます/です/ています/ません).
   */
  valid_orders: number[][];
  /** The single most natural order, also a permutation of bunsetsu indices. */
  preferred_order: number[];
  translation: string;
  verified: boolean;
  /** Free-form labels for cross-referencing, e.g. "particle:wa". */
  tags: string[];
  /** Optional authoring note, e.g. flagging that `valid_orders` is a curated sample rather than an exhaustive permutation list. */
  note?: string;
}

/** One SentenceToken after build-bank.ts has run it through kanaToCells/readingToRomaji (with its own `particle` flag). */
export interface BuiltSentenceToken extends SentenceToken {
  morae: Mora[];
  romaji: string;
}

/** A SentenceSeed after scripts/build-bank.ts has computed its derived fields. */
export interface Sentence extends Omit<SentenceSeed, "tokens"> {
  tokens: BuiltSentenceToken[];
  /** tokens' surfaces concatenated + "。" -- not authored, always derived so it can never drift from `tokens`. */
  ja: string;
  /** Every token's romaji, joined with a single space. */
  romaji: string;
}

/** Shape of one data/sentences/*.json file. */
export interface SentenceFile {
  sentences: SentenceSeed[];
}

// ---------------------------------------------------------------------------
// Particles (build task 2026-09 step 4, DESIGN.md §8.4). Unlike words/
// sentences, particles.json has no derived fields -- romaji/cell are
// hand-authored (there are only 8, and their readings are all irregular
// exceptions anyway -- see DESIGN.md §7) and build-bank.ts only validates
// and passes the file through unchanged into bank.json's `particles` field.

/** Single source of truth for the 8-particle id set. */
export const PARTICLE_IDS = ["wa", "ga", "wo", "ni", "de", "to", "no", "mo"] as const;
export type ParticleId = (typeof PARTICLE_IDS)[number];

export const PARTICLE_CLASS_VALUES = ["kaku", "kakari", "rentai"] as const;
export type ParticleClass = (typeof PARTICLE_CLASS_VALUES)[number];

export const PARTICLE_WEIGHT_VALUES = ["heavy", "medium", "light"] as const;
export type ParticleWeight = (typeof PARTICLE_WEIGHT_VALUES)[number];

/** One named usage of a particle, pointing at the Sentence that demonstrates it. */
export interface ParticleSense {
  label: string;
  example_id: string;
}

export interface Particle {
  id: ParticleId;
  surface: string;
  reading: string;
  romaji: string;
  /** Only non-null for irregular readings (currently just は). */
  romaji_note: string | null;
  /** Which of the 46 gojuon-table cells lights up for this particle (its *base* seion cell -- e.g. が lights up "ka", で lights up "te"). */
  cell: CellId;
  class: ParticleClass;
  core: string;
  zh_bridge: string;
  senses: ParticleSense[];
  contrast_with: ParticleId[];
  weight: ParticleWeight;
}

export interface ContrastPair {
  sentence_id: string;
  note: string;
}

export interface ContrastSet {
  id: string;
  particles: ParticleId[];
  title: string;
  summary: string;
  pairs: ContrastPair[];
  /** Reserved for §8.5 practice exercises; always [] in this build task. */
  exercise_ids: string[];
}

/** Shape of data/particles.json, and (unchanged) of bank.json's `particles` field. */
export interface ParticlesFile {
  particles: Particle[];
  contrast_sets: ContrastSet[];
}
