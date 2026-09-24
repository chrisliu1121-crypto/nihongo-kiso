// dailyKanaQuiz — pure generator for the "/practice/kana" daily 50-question
// deck (30 questions/day, two question types, DESIGN.md-adjacent build task
// 2026-09 "五十音練習"). Zero React, zero data/kana.json import -- callers
// pass in the 46 KanaCell records (same pattern as arrange.ts taking a
// Sentence rather than reading bank.json itself) so this stays unit-testable
// without touching any build artifact.
//
// Determinism: `dateKey` (YYYY-MM-DD, see src/lib/bank/dates.ts's
// todayKey) is hashed into a single integer seed, fed into the same
// mulberry32 PRNG style src/lib/exercise/arrange.ts already uses for its
// deterministic shuffle -- same seed => byte-identical question set, every
// time, on any machine (required so "today's 30" really is stable across
// reloads, and a test can assert exact output). A different dateKey almost
// certainly produces a different seed => a different set.
//
// The one romaji collision among the 46 cells: kana.json gives を (wo) the
// SAME romaji ("o") as お (o) -- see data/kana.json's own "wo" cell. That
// makes を's romaji ambiguous as a romaji-to-kana question stem (the
// learner would have no way to tell which of お/を the stem "o" means), so
// を is simply never chosen as the correct answer of a romaji-to-kana
// question here (see pickTypeSequence). It still appears normally as a
// kana-to-romaji question (お in hand, three romaji options, "o" among
// them) -- reading it is never ambiguous, only "typing back" its romaji is.

import type { CellId, KanaCell } from "../kana";
import { shapeConfusablesOf, soundConfusablesOf } from "./confusables";

export type QuizQuestionType = "kana-to-romaji" | "romaji-to-kana";

export interface QuizOption {
  cellId: CellId;
  /** What's shown on the option button: a romaji string (kana-to-romaji) or a hiragana string (romaji-to-kana). */
  label: string;
  correct: boolean;
}

export interface KanaQuestion {
  /** Stable per dateKey+slot+cell+type -- safe as a React list key. */
  id: string;
  type: QuizQuestionType;
  /** The tested cell: kana-to-romaji's stem cell, or romaji-to-kana's answer cell. */
  cellId: CellId;
  /** The big stem text -- hiragana for kana-to-romaji, romaji for romaji-to-kana. Always plain text, never routed through Token (see PracticeKana.tsx's own comment on why). */
  prompt: string;
  /** Exactly 3, deterministically shuffled, exactly one with correct: true. */
  options: QuizOption[];
}

const QUESTIONS_PER_DAY = 30;
const QUESTIONS_PER_TYPE = QUESTIONS_PER_DAY / 2;
const SLIDING_WINDOW = 10;
const OPTIONS_PER_QUESTION = 3;

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) + a string -> uint32 seed hash (FNV-1a).
// Both are small, dependency-free, reproducible -- same shape as
// src/lib/exercise/arrange.ts's own mulberry32, kept as this file's own copy
// rather than an import since arrange.ts doesn't export it (and this file
// must stay out of src/lib/exercise/ per this build's own scope).

function seedFromDateKey(dateKey: string): number {
  let hash = 0x811c9dc5; // FNV-1a offset basis
  for (let i = 0; i < dateKey.length; i++) {
    hash ^= dateKey.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

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

/** Pop one random element out of `pool` (mutates it) using `rng`, or undefined if empty. */
function takeRandom<T>(pool: T[], rng: () => number): T | undefined {
  if (pool.length === 0) return undefined;
  const idx = Math.floor(rng() * pool.length);
  return pool.splice(idx, 1)[0];
}

// ---------------------------------------------------------------------------
// Row/column grouping helpers. "n" has row === "" and col === "" in
// kana.json -- it must never be treated as sharing a row/col with the five
// pure-vowel cells (a/i/u/e/o), which also have row === "" but a real col.

function isPureVowelCell(cell: KanaCell): boolean {
  return cell.row === "" && cell.col !== "";
}

/** Same consonant row (か/き/く/け/こ etc.), or both pure vowels -- never involving "n". */
function sameRowGroup(a: KanaCell, b: KanaCell): boolean {
  if (a.id === "n" || b.id === "n") return false;
  if (isPureVowelCell(a) && isPureVowelCell(b)) return true;
  return a.row !== "" && a.row === b.row;
}

/** Same vowel column (あ/か/さ/た... share "a"), never involving "n". */
function sameColGroup(a: KanaCell, b: KanaCell): boolean {
  if (a.id === "n" || b.id === "n") return false;
  return a.col !== "" && a.col === b.col;
}

// ---------------------------------------------------------------------------
// Cell-sequence generation: 30 cellIds, sliding-window-10 distinct.

function pickCellSequence(ids: readonly CellId[], rng: () => number): CellId[] {
  const seq: CellId[] = [];
  for (let i = 0; i < QUESTIONS_PER_DAY; i++) {
    const windowStart = Math.max(0, i - (SLIDING_WINDOW - 1));
    const recent = new Set(seq.slice(windowStart));
    const candidates = ids.filter((id) => !recent.has(id));
    // 46 cells, window of at most 9 excluded -- always >= 37 candidates left.
    const pick = candidates[Math.floor(rng() * candidates.length)];
    seq.push(pick);
  }
  return seq;
}

/** cellId at position i, position j, |i-j| < windowSize: they're never the same. Exported for tests. */
export function slidingWindowOk(
  questions: readonly Pick<KanaQuestion, "cellId">[],
  windowSize: number,
): boolean {
  for (let i = 0; i < questions.length; i++) {
    const start = Math.max(0, i - (windowSize - 1));
    for (let j = start; j < i; j++) {
      if (questions[j].cellId === questions[i].cellId) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Type-sequence generation: 15/15 kana-to-romaji/romaji-to-kana, shuffled,
// with the "を never gets romaji-to-kana" fixup swapped in afterwards.

function pickTypeSequence(cellSeq: readonly CellId[], rng: () => number): QuizQuestionType[] {
  const base: QuizQuestionType[] = [
    ...Array<QuizQuestionType>(QUESTIONS_PER_TYPE).fill("kana-to-romaji"),
    ...Array<QuizQuestionType>(QUESTIONS_PER_TYPE).fill("romaji-to-kana"),
  ];
  const types = shuffleWithRng(base, rng);

  for (let i = 0; i < types.length; i++) {
    if (cellSeq[i] !== "wo" || types[i] !== "romaji-to-kana") continue;
    // Swap with the first OTHER slot that's kana-to-romaji and isn't itself
    // a "wo" slot (swapping two "wo" slots' types would just move the
    // violation, not fix it). 15 kana-to-romaji slots vs. at most a
    // handful of "wo" occurrences across 30 slots (46-cell pool) -- always
    // findable in practice; findIndex returning -1 is a no-op (leaves the
    // rare theoretical failure as-is rather than throwing).
    const j = types.findIndex((t, idx) => t === "kana-to-romaji" && cellSeq[idx] !== "wo");
    if (j === -1) continue;
    [types[i], types[j]] = [types[j], types[i]];
  }

  return types;
}

// ---------------------------------------------------------------------------
// Distractor selection. Both directions: 2 distractors, cellId distinct from
// each other and from the correct cell. kana-to-romaji ALSO requires every
// option's romaji string to be distinct (the generic guard that keeps お/を
// from ever appearing together as romaji options); romaji-to-kana ALSO
// requires every distractor's romaji to differ from the correct cell's
// romaji (the generic guard that keeps the stem unambiguous).

function pickKanaToRomajiDistractors(
  correct: KanaCell,
  allCells: readonly KanaCell[],
  byId: Map<CellId, KanaCell>,
  rng: () => number,
): KanaCell[] {
  const usedIds = new Set<CellId>([correct.id]);
  const usedLabels = new Set<string>([correct.romaji]);
  const result: KanaCell[] = [];

  const tiers: KanaCell[][] = [
    soundConfusablesOf(correct.id)
      .map((id) => byId.get(id))
      .filter((c): c is KanaCell => c !== undefined),
    allCells.filter((c) => sameColGroup(correct, c)),
    allCells.filter((c) => sameRowGroup(correct, c)),
    allCells.slice(),
  ];

  for (const tier of tiers) {
    if (result.length >= 2) break;
    let pool = tier.filter((c) => !usedIds.has(c.id) && !usedLabels.has(c.romaji));
    while (result.length < 2) {
      const picked = takeRandom(pool, rng);
      if (picked === undefined) break;
      result.push(picked);
      usedIds.add(picked.id);
      usedLabels.add(picked.romaji);
      // Picking `picked` can invalidate OTHER still-pending pool entries
      // that happen to share its romaji (the only case: an "o"/"wo" pair
      // both sitting in the same tier) -- drop them too, or the next
      // iteration could still hand out a duplicate label.
      const pickedRomaji = picked.romaji;
      pool = pool.filter((c) => c.romaji !== pickedRomaji);
    }
  }

  return result;
}

function pickRomajiToKanaDistractors(
  correct: KanaCell,
  allCells: readonly KanaCell[],
  byId: Map<CellId, KanaCell>,
  rng: () => number,
): KanaCell[] {
  const usedIds = new Set<CellId>([correct.id]);
  const result: KanaCell[] = [];

  const tiers: KanaCell[][] = [
    shapeConfusablesOf(correct.id)
      .map((id) => byId.get(id))
      .filter((c): c is KanaCell => c !== undefined),
    allCells.filter((c) => sameRowGroup(correct, c)),
    allCells.slice(),
  ];

  for (const tier of tiers) {
    if (result.length >= 2) break;
    const pool = tier.filter((c) => !usedIds.has(c.id) && c.romaji !== correct.romaji);
    let picked: KanaCell | undefined;
    while (result.length < 2 && (picked = takeRandom(pool, rng)) !== undefined) {
      result.push(picked);
      usedIds.add(picked.id);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------

function buildQuestion(
  dateKey: string,
  slotIndex: number,
  cell: KanaCell,
  type: QuizQuestionType,
  allCells: readonly KanaCell[],
  byId: Map<CellId, KanaCell>,
  rng: () => number,
): KanaQuestion {
  const distractors =
    type === "kana-to-romaji"
      ? pickKanaToRomajiDistractors(cell, allCells, byId, rng)
      : pickRomajiToKanaDistractors(cell, allCells, byId, rng);

  const labelOf = (c: KanaCell) => (type === "kana-to-romaji" ? c.romaji : c.hiragana);

  const options: QuizOption[] = shuffleWithRng(
    [
      { cellId: cell.id, label: labelOf(cell), correct: true },
      ...distractors.map((d) => ({ cellId: d.id, label: labelOf(d), correct: false })),
    ],
    rng,
  );

  return {
    id: `${dateKey}:${slotIndex}:${cell.id}:${type}`,
    type,
    cellId: cell.id,
    prompt: type === "kana-to-romaji" ? cell.hiragana : cell.romaji,
    options,
  };
}

/**
 * Today's (well, `dateKey`'s) 30-question kana quiz: 15 kana-to-romaji + 15
 * romaji-to-kana, shuffled together, with no cellId repeating within any
 * 10-question window. Same (dateKey, cells) always produces the exact same
 * array -- see this file's header comment for the determinism mechanism.
 */
export function dailyKanaQuiz(dateKey: string, cells: readonly KanaCell[]): KanaQuestion[] {
  const rng = mulberry32(seedFromDateKey(dateKey));
  const byId = new Map(cells.map((c) => [c.id, c] as const));
  const ids = cells.map((c) => c.id);

  const cellSeq = pickCellSequence(ids, rng);
  const typeSeq = pickTypeSequence(cellSeq, rng);

  return cellSeq.map((cellId, i) => {
    const cell = byId.get(cellId);
    if (!cell) {
      throw new Error(`dailyKanaQuiz: cellId ${JSON.stringify(cellId)} missing from cells`);
    }
    return buildQuestion(dateKey, i, cell, typeSeq[i], cells, byId, rng);
  });
}

// ---------------------------------------------------------------------------
// Extra check functions for tests (src/lib/quiz/__tests__/kana.test.ts).

/** Exactly one option is marked correct. */
export function hasSingleCorrectOption(question: KanaQuestion): boolean {
  return question.options.filter((o) => o.correct).length === 1;
}

/** Exactly OPTIONS_PER_QUESTION (3) options, all distinct cellIds. */
export function hasDistinctOptionCells(question: KanaQuestion): boolean {
  if (question.options.length !== OPTIONS_PER_QUESTION) return false;
  return new Set(question.options.map((o) => o.cellId)).size === OPTIONS_PER_QUESTION;
}

/** All 3 option labels are distinct strings (required for kana-to-romaji; trivially true for romaji-to-kana). */
export function hasDistinctOptionLabels(question: KanaQuestion): boolean {
  return new Set(question.options.map((o) => o.label)).size === question.options.length;
}

/**
 * romaji-to-kana only: the stem romaji (question.prompt) matches exactly one
 * of the 3 options' cellId-derived romaji -- i.e. no ambiguity about which
 * kana the stem means (the お/を guard, generalized). Always true for
 * kana-to-romaji questions (nothing to check -- the stem IS a specific
 * cell's hiragana, not a shared romaji string).
 */
export function stemMapsToSingleOption(question: KanaQuestion, byId: Map<CellId, KanaCell>): boolean {
  if (question.type === "kana-to-romaji") return true;
  const matches = question.options.filter((o) => byId.get(o.cellId)?.romaji === question.prompt);
  return matches.length === 1;
}
