// Re-export barrel for the exercise judge layer (build task 2026-09 step 5).

export type {
  ArrangeExercise,
  Exercise,
  ExerciseFile,
  ParticleSwapExercise,
  SwapCandidate,
  SwapVerdict,
} from "./types.ts";
export { SWAP_VERDICT_VALUES } from "./types.ts";

export type { ArrangeInvalidRule, ArrangeVerdict, Chunk } from "./arrange.ts";
export { chunksOf, isPredicate, judgeArrange, shuffleChunks } from "./arrange.ts";

export { applyCandidate, resolveSwap } from "./swap.ts";

export type { ReadingToken } from "./highlight.ts";
export { buildContextFromTokens } from "./highlight.ts";
