// buildContextFromTokens — the ONE place outside Token.tsx allowed to build
// a HighlightSet by hand for a whole sentence (build task 2026-09 step 5).
//
// buildHighlightSet (src/store/highlight.ts) takes a single reading string
// and runs it through kanaToCells -- correct for one Token, but DESIGN.md §7
// warns that feeding a WHOLE sentence's concatenated reading through
// kanaToCells in one call can misread an unrelated word-boundary vowel pair
// as a long vowel (the documented お金"ga" + "あ"りません -> "gā" bug) and
// can't apply the は/へ/を particle override per-token. So this calls
// buildHighlightSet once per token (each with its OWN `particle` flag, same
// as every other per-token call site in this codebase) and merges the
// resulting entries by cellId -- the context layer only needs "which cells
// does this exercise touch" (resolveCell strips context's orders/marks down
// to nothing anyway, DESIGN.md §5.2), but the merge is done properly (union
// of orders/marks per cell) rather than just collecting cell ids, so this
// stays reusable if a future context-layer consumer wants more than a flat
// background.

import { buildHighlightSet } from "../../store/highlight.ts";
import type { HighlightEntry, HighlightSet } from "../../store/highlight.ts";
import type { CellId } from "../kana/types.ts";

/** The minimum shape buildContextFromTokens needs from a token -- satisfied by both SentenceToken and BuiltSentenceToken. */
export interface ReadingToken {
  reading: string;
  particle?: boolean;
}

/** Build one merged context-layer HighlightSet covering every cell any of `tokens` touches, calling buildHighlightSet once per token (never once for the whole sentence -- see this file's header comment for why). */
export function buildContextFromTokens(sourceId: string, tokens: readonly ReadingToken[]): HighlightSet {
  const byCell = new Map<CellId, HighlightEntry>();

  for (const token of tokens) {
    const set = buildHighlightSet(sourceId, token.reading, { particle: token.particle });
    for (const entry of set.entries) {
      let merged = byCell.get(entry.cellId);
      if (!merged) {
        merged = { cellId: entry.cellId, orders: [], marks: [] };
        byCell.set(entry.cellId, merged);
      }
      for (const order of entry.orders) {
        if (!merged.orders.includes(order)) merged.orders.push(order);
      }
      for (const mark of entry.marks) {
        if (!merged.marks.includes(mark)) merged.marks.push(mark);
      }
    }
  }

  return { sourceId, entries: Array.from(byCell.values()) };
}
