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

import type { Mora } from "../kana/types.ts";

export type PartOfSpeech =
  | "名詞"
  | "動詞"
  | "い形容詞"
  | "な形容詞"
  | "副詞"
  | "代名詞"
  | "疑問詞"
  | "表現";

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
}
