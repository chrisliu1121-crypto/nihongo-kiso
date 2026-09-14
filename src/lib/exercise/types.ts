// Types for the practice-exercise layer (build task 2026-09 step 5,
// DESIGN.md §8.5: "共用外殼，type 決定 renderer（registry 模式）"). Pure
// data shapes only -- no React here. Mirrors the WordSeed/Word and
// SentenceSeed/Sentence split in ../bank/types.ts: these ARE both the
// author-facing seed shape (data/exercises/seed.json) and the built shape
// (bank.exercises) at once, because -- unlike words/sentences -- nothing
// about an exercise is computed at build time; scripts/build-bank.ts only
// validates and passes them through unchanged (same treatment as
// data/particles.json).

import type { ParticleId } from "../bank/types.ts";

/** Common fields every exercise type shares, before the `type`-specific payload. */
interface ExerciseBase {
  id: string;
  /** Which data/sentences/*.json sentence supplies the tokens/bunsetsu/valid_orders this exercise judges against. */
  sentence_id: string;
  /** DESIGN.md §9.3: unreviewed content stays visible but flagged, never hidden. */
  verified: boolean;
  /**
   * Which generation batch this exercise came from, for the practice pages'
   * 回顧選單 (review panel) grouping. `undefined` for the hand-authored
   * data/exercises/seed.json set (rendered as "種子題組"); a future daily
   * generator fills this with its own run's `YYYY-MM-DD`. Optional and
   * unvalidated by scripts/build-bank.ts -- it's a display grouping key, not
   * a fact this build checks.
   */
  batch?: string;
}

/**
 * A word-order arrangement drill (DESIGN.md §8.5 "排列練習"). Everything
 * about the puzzle itself -- the blocks, the correct answer, the acceptable
 * alternates -- comes from `sentence_id`'s bunsetsu/valid_orders/preferred_order;
 * this record only adds the prompt shown to the learner.
 */
export interface ArrangeExercise extends ExerciseBase {
  type: "arrange";
  prompt_zh: string;
  hints: string[];
  /**
   * Reserved for a future "extra blocks that don't belong in this sentence"
   * mode (DESIGN.md §8.5 lists `distractors` as optional and currently
   * unused). Fixed to an empty array in this build task -- the type says so
   * literally so a future distractor entry can't be added without a type
   * change forcing every call site to be re-examined.
   */
  distractors: never[];
}

/** The four-way honesty scale for a single particle substituted into a sentence slot (DESIGN.md §8.5: "四值比對錯二值誠實"). */
export const SWAP_VERDICT_VALUES = ["natural", "different", "marginal", "invalid"] as const;
export type SwapVerdict = (typeof SWAP_VERDICT_VALUES)[number];

/** One candidate particle for a particle-swap slot, and how it reads if substituted in. */
export interface SwapCandidate {
  particle_id: ParticleId;
  verdict: SwapVerdict;
  /** Chinese translation of the sentence WITH this particle substituted in; null only for `invalid` (there's nothing correct to translate). */
  translation: string | null;
  /** One-sentence explanation, kept conservative (schema-rules-by-function memory: never expand grammar theory beyond what's needed to justify the verdict). */
  note: string;
}

/**
 * A particle-contrast explorer (DESIGN.md §8.5 "助詞對照器"). `slot_token_index`
 * names which token of `sentence_id` gets swapped; `candidates` is NOT
 * multiple-choice -- several can be simultaneously grammatical (`natural`/
 * `different`/`marginal`), only `invalid` is wrong (DESIGN.md §2.4/§7.2:
 * "好幾個都對，但講的是不同的事").
 */
export interface ParticleSwapExercise extends ExerciseBase {
  type: "particle-swap";
  slot_token_index: number;
  /** The particle ids this exercise most wants contrasted (a subset of `candidates`' particle_ids), rendered with a distinguishing border in the UI. */
  focus: ParticleId[];
  candidates: SwapCandidate[];
}

/** Registry-dispatched union (DESIGN.md §8.5). Future exercise types (Cloze / Listening / Translate) join this union without touching existing renderers. */
export type Exercise = ArrangeExercise | ParticleSwapExercise;

/** Shape of one data/exercises/*.json file. */
export interface ExerciseFile {
  exercises: Exercise[];
}
