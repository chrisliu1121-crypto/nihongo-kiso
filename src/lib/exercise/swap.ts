// Particle-swap explorer helpers (build task 2026-09 step 5, DESIGN.md
// §2.4/§8.5 "助詞對照器"). Pure TS, zero React.
//
// This is deliberately NOT multiple choice: `resolveSwap` just looks up
// whichever candidate the learner picked, and the UI is responsible for
// showing its verdict/translation/note as-is, however many other candidates
// are ALSO grammatical (DESIGN.md §2.4: "好幾個都對，但講的是不同的事").

import type { Particle, ParticleId, Sentence, SentenceToken } from "../bank/types.ts";
import type { ParticleSwapExercise, SwapCandidate } from "./types.ts";

/** The candidate for `particleId` on `exercise`, or undefined if it isn't offered (the UI should only ever call this with a particle_id drawn from `exercise.candidates`, so undefined signals a caller bug, not a normal outcome). */
export function resolveSwap(
  exercise: ParticleSwapExercise,
  particleId: ParticleId,
): SwapCandidate | undefined {
  return exercise.candidates.find((c) => c.particle_id === particleId);
}

/**
 * `sentence.tokens` with the token at `slotIndex` replaced by `particle`
 * (surface/reading swapped to the particle's, `particle: true` set). Returns
 * plain SentenceToken data, not BuiltSentenceToken -- deliberately: the
 * substituted token's morae/romaji were never computed for this
 * combination, and re-deriving them here would duplicate what Token.tsx
 * already does at render time from surface/reading alone (see Token's own
 * `romaji`-is-optional prop). Every OTHER token is passed through with its
 * own morae/romaji dropped for the same reason -- the caller renders this
 * array through Token, which only ever needs surface/reading/gloss/particle.
 *
 * gloss for the swapped-in particle is fixed to "（助詞）" rather than
 * derived from the candidate's `note` (DESIGN.md leaves this open -- see
 * this build task's own report for why the fixed string was chosen: it
 * keeps this function a function of (sentence, slotIndex, particle) alone,
 * with no implicit dependency on which SwapCandidate the caller is
 * currently showing).
 */
export function applyCandidate(
  sentence: Sentence,
  slotIndex: number,
  particle: Particle,
): SentenceToken[] {
  return sentence.tokens.map((token, i): SentenceToken => {
    if (i !== slotIndex) {
      return {
        surface: token.surface,
        reading: token.reading,
        gloss: token.gloss,
        particle: token.particle,
      };
    }
    return {
      surface: particle.surface,
      reading: particle.reading,
      gloss: "（助詞）",
      particle: true,
    };
  });
}
