// Pure search/filter helper for the /bank word-bank page (WordBank.tsx),
// split out of index.ts the same way dates.ts/grammar.ts are -- so it's
// unit-testable without importing the gitignored data/bank.json (see
// index.ts's own header comment on why importing it can fail on a fresh
// clone before `npm run build:bank` has ever run).

import type { Word } from "./types.ts";

/** True if `query` (case-insensitive, trimmed) is a substring of any of
 *  `word`'s searchable text: surface, reading, romaji_ascii, gloss. An
 *  empty/whitespace-only query matches every word. */
export function matchesWord(word: Word, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    word.surface.toLowerCase().includes(q) ||
    word.reading.toLowerCase().includes(q) ||
    word.romaji_ascii.toLowerCase().includes(q) ||
    word.gloss.toLowerCase().includes(q)
  );
}

/**
 * Filters `words` down to those matching `query` (see matchesWord). An
 * empty/whitespace-only query returns `words` itself unchanged (same array
 * reference), so callers can tell "unfiltered" apart from "filtered to
 * everything" cheaply if they ever need to.
 */
export function filterWords(words: Word[], query: string): Word[] {
  if (!query.trim()) return words;
  return words.filter((w) => matchesWord(w, query));
}
