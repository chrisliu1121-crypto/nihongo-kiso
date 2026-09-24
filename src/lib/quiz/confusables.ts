// confusables — two hand-curated "which kana get mixed up" tables used by
// src/lib/quiz/kana.ts to pick distractors that actually teach something,
// instead of three random unrelated cells. Pure data + lookup, zero React.
//
// SHAPE_GROUPS: hiragana that LOOK alike (beginner "these are basically the
// same squiggle" mistakes) -- used as the first-choice distractor pool for
// romaji-to-kana questions (DESIGN.md-adjacent build task, "誘答優先
// 字形相近"). Every cellId here is real (checked by
// src/lib/quiz/__tests__/confusables.test.ts against the full 46-cell set).
//
// SOUND_GROUPS: romaji that SOUND/READ alike (beginner mishears or
// mistransliterations) -- used as the first-choice pool for kana-to-romaji
// questions ("誘答優先發音相近"). The task's own text spells these four
// groups out explicitly:
//   - shi/chi/tsu/su: the four "hissy" consonant-final sounds English
//     speakers conflate.
//   - fu/hu: kana.json only ever spells this cell "fu" (never "hu"), so
//     there is nothing to pair it WITH here -- noted, not encoded as a
//     group of one.
//   - ra/ri/ru/re/ro vs "la": Japanese has no l/r distinction, so English
//     speakers reading romaji reach for an "la" that doesn't exist in this
//     table; the whole r-row is grouped as each other's most natural
//     distractor instead.
//   - n/nu/mu: the bare "n" mora read next to nu/mu, which both END in the
//     same vowel-less-looking "n" when a learner mis-parses the romaji.
//   - o/wo: kana.json gives を the SAME romaji ("o") as お (see
//     src/lib/quiz/kana.ts's own header comment on why that's the one
//     genuine romaji collision among the 46 cells). Keeping this pair here
//     is harmless -- kana.ts's generic "no duplicate option label" rule
//     already refuses to ever put お and を's romaji in the same question,
//     so this group can never actually surface both at once; it's kept for
//     documentation fidelity to the task's own list.
//
// Both tables are deliberately NOT exhaustive over all 46 cells -- a few
// kana (と, ふ, を itself) don't have a strong, defensible look-alike in
// common beginner-confusion references, so they're left to fall back to
// kana.ts's next-tier "same row" / random pick instead of a forced, made-up
// pairing.

import type { CellId } from "../kana";

export type ConfusableGroup = readonly CellId[];

// Shape (visual) confusable groups. さ/ち/き, ぬ/め/あ/の(+え), ね/れ/わ(+え),
// る/ろ/そ, は/ほ/け, ま/も/よ, う/つ/ら, い/り/こ(+ひ), た/な/に, す/む/お,
// く/へ, し/つ/ん, ゆ/よ/わ(+や) are the task's own examples (え/ひ/や added
// alongside them below); か/こ, せ/む/み, て/つ are additional pairs this
// build filled in to cover more of the 46 cells with equally common
// beginner mix-ups.
export const SHAPE_GROUPS: ConfusableGroup[] = [
  ["sa", "chi", "ki"],
  ["nu", "me", "a", "no", "e"],
  ["ne", "re", "wa", "e"],
  ["ru", "ro", "so"],
  ["ha", "ho", "ke"],
  ["ma", "mo", "yo"],
  ["u", "tsu", "ra"],
  ["i", "ri", "ko", "hi"],
  ["ta", "na", "ni"],
  ["su", "mu", "o"],
  ["ku", "he"],
  ["shi", "tsu", "n"],
  ["yu", "yo", "wa", "ya"],
  ["ka", "ko"],
  ["se", "mu", "mi"],
  ["te", "tsu"],
];

// Sound (romaji) confusable groups -- see the header comment above for why
// each one is here (and why "fu/hu" isn't encoded as a group at all).
export const SOUND_GROUPS: ConfusableGroup[] = [
  ["shi", "chi", "tsu", "su"],
  ["ra", "ri", "ru", "re", "ro"],
  ["n", "nu", "mu"],
  ["o", "wo"],
];

function buildLookup(groups: readonly ConfusableGroup[]): Map<CellId, CellId[]> {
  const sets = new Map<CellId, Set<CellId>>();
  for (const group of groups) {
    for (const id of group) {
      let set = sets.get(id);
      if (!set) {
        set = new Set();
        sets.set(id, set);
      }
      for (const other of group) {
        if (other !== id) set.add(other);
      }
    }
  }
  const result = new Map<CellId, CellId[]>();
  for (const [id, set] of sets) result.set(id, Array.from(set));
  return result;
}

const SHAPE_LOOKUP = buildLookup(SHAPE_GROUPS);
const SOUND_LOOKUP = buildLookup(SOUND_GROUPS);

/** Every cellId whose shape is commonly confused with `cellId`, deterministic order, empty if none curated. */
export function shapeConfusablesOf(cellId: CellId): CellId[] {
  return SHAPE_LOOKUP.get(cellId) ?? [];
}

/** Every cellId whose romaji is commonly confused with `cellId`'s, deterministic order, empty if none curated. */
export function soundConfusablesOf(cellId: CellId): CellId[] {
  return SOUND_LOOKUP.get(cellId) ?? [];
}
