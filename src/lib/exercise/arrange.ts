// Arrange-practice judge (build task 2026-09 step 5, DESIGN.md §2.2/§8.5).
// Pure TS, zero React -- the puzzle's blocks/answer/acceptable-alternates all
// come from a Sentence (bunsetsu/valid_orders/preferred_order), computed
// once at build time by scripts/build-bank.ts; this file only judges an
// in-progress attempt and shuffles the block pool.
//
// DESIGN.md §2.2 is the reason this can't be a single-answer check: "日語唯
// 一硬性的位置規則是「動詞在最後」" -- everything before the predicate is
// free to reorder with only a shift in nuance, not a grammar error. Hence
// the three-way verdict (natural / acceptable / invalid) rather than
// right/wrong.

import type { BuiltSentenceToken, Sentence } from "../bank/types.ts";

/** Predicate-ending suffixes that mark a bunsetsu as the sentence's verb/predicate.
 *  Kept as this file's own copy of scripts/build-bank.ts's PREDICATE_SUFFIXES
 *  (that one is a private, unexported const) -- see this file's own isPredicate
 *  for the reasoning on why the extra suffixes are redundant-but-harmless. */
const PREDICATE_SUFFIXES = ["ます", "です", "ています", "ません", "たいです"];

/**
 * Whether `surface` (a bunsetsu's LAST token's surface) marks that bunsetsu
 * as the sentence's predicate. Note ています/たいです are already covered by
 * plain ます/です (「ています」ends in 「ます」, 「たいです」ends in 「です」)
 * -- both are still listed explicitly so this reads as a direct match for
 * DESIGN.md's own wording, not a claim that they add distinct behavior.
 */
export function isPredicate(surface: string): boolean {
  return PREDICATE_SUFFIXES.some((suffix) => surface.endsWith(suffix));
}

/** One bunsetsu (文節) rendered as an arrange-practice block. */
export interface Chunk {
  /** Index into `sentence.bunsetsu` -- the same index valid_orders/preferred_order permute. */
  index: number;
  tokens: BuiltSentenceToken[];
  isPredicate: boolean;
}

/** Split `sentence` into its bunsetsu blocks, in the sentence's own authored (0..n-1) order. */
export function chunksOf(sentence: Sentence): Chunk[] {
  return sentence.bunsetsu.map((tokenIndices, index) => {
    const tokens = tokenIndices.map((i) => sentence.tokens[i]);
    const lastToken = tokens[tokens.length - 1];
    return { index, tokens, isPredicate: lastToken !== undefined && isPredicate(lastToken.surface) };
  });
}

export type ArrangeInvalidRule = "verb_final" | "no_duplicate" | "incomplete";

export type ArrangeVerdict =
  | { kind: "natural" }
  | { kind: "acceptable"; note: string }
  | { kind: "invalid"; rule: ArrangeInvalidRule; note: string };

function sameOrder(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** `order` is exactly a permutation of [0..n-1]: same length, every index present once. */
function isPermutationOf(order: readonly number[], n: number): boolean {
  if (order.length !== n) return false;
  const seen = new Set(order);
  if (seen.size !== n) return false;
  for (let i = 0; i < n; i++) if (!seen.has(i)) return false;
  return true;
}

/**
 * Judge one arrangement attempt, `order` being a permutation of `sentence`'s
 * BUNSETSU indices (not token indices -- same convention as valid_orders/
 * preferred_order). Three-way verdict per DESIGN.md §8.5:
 *
 *   natural    -- `order` is literally one of `valid_orders`.
 *   acceptable -- not listed, but passes the rule checker (grammatical, just
 *                 an order the seed didn't happen to enumerate -- DESIGN.md's
 *                 own note field on s_g033 says valid_orders is "常見自然
 *                 序，非窮舉", i.e. not exhaustive).
 *   invalid    -- fails a rule. `incomplete` (order shorter than the bunsetsu
 *                 count) is checked FIRST and separately from `no_duplicate`:
 *                 an in-progress arrangement (the learner hasn't placed every
 *                 block yet) has no "last bunsetsu" worth judging for
 *                 verb-finality, so it must be caught before that check runs,
 *                 not reported as a verb-position error.
 */
export function judgeArrange(sentence: Sentence, order: readonly number[]): ArrangeVerdict {
  const nb = sentence.bunsetsu.length;

  if (order.length < nb) {
    return { kind: "invalid", rule: "incomplete", note: "還沒有排完所有的積木" };
  }
  if (!isPermutationOf(order, nb)) {
    return {
      kind: "invalid",
      rule: "no_duplicate",
      note: "每塊積木必須恰好用一次：有重複或缺塊",
    };
  }

  const lastBunsetsuIndex = order[order.length - 1];
  const lastBunsetsu = sentence.bunsetsu[lastBunsetsuIndex];
  const lastToken = sentence.tokens[lastBunsetsu[lastBunsetsu.length - 1]];
  if (!isPredicate(lastToken.surface)) {
    return {
      kind: "invalid",
      rule: "verb_final",
      note: "動詞（述語）文節必須放在最後",
    };
  }

  const isNatural = sentence.valid_orders.some((validOrder) => sameOrder(validOrder, order));
  if (isNatural) return { kind: "natural" };

  return {
    kind: "acceptable",
    note: "文法正確，但這個語序較少見或語感不同",
  };
}

// ---------------------------------------------------------------------------
// Deterministic shuffle (mulberry32 -- small, dependency-free, reproducible
// from an integer seed so tests can assert exact output).

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWithRng<T>(items: readonly T[], rng: () => number): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Deterministically shuffle `chunks` (same `seed` + same input always
 * produces the same output order -- required so tests, and a "reshuffle"
 * button that should look different from THIS render but be reproducible in
 * a test, both work). When `avoidOrder` is given (DESIGN.md §8.5: the pool
 * must not start out already arranged as `preferred_order` -- that would
 * hand the learner the answer for free) and the first shuffle's `.index`
 * sequence matches it, the seed is bumped and reshuffled, up to a small
 * retry cap (chunks.length <= 1 can never differ from any single order, so
 * the cap avoids looping forever on a one-block sentence).
 */
export function shuffleChunks(
  chunks: readonly Chunk[],
  seed: number,
  avoidOrder?: readonly number[],
): Chunk[] {
  const MAX_ATTEMPTS = 20;
  let attempt = 0;
  let result = shuffleWithRng(chunks, mulberry32(seed + attempt));
  while (
    avoidOrder &&
    chunks.length > 1 &&
    sameOrder(result.map((c) => c.index), avoidOrder) &&
    attempt < MAX_ATTEMPTS
  ) {
    attempt += 1;
    result = shuffleWithRng(chunks, mulberry32(seed + attempt));
  }
  return result;
}
