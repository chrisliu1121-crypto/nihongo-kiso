// summary — pure derived-state helpers for the mobile KanaDrawer's
// collapsed strip (DESIGN.md §2.1 "行動版為底部抽屜，收合時剩一條
// 「已點亮 n/46」的細條"). Kept separate from highlight.ts itself (which
// stays the single source of truth for the three-layer state) so these can
// be unit tested without pulling in any component code, and reused by both
// the "n/46" counter and the mini dot matrix.

import type { HighlightState, Layer } from "./highlight";
import type { CellId } from "../lib/kana";

const LAYER_PRIORITY: Layer[] = ["hover", "pinned", "context"];

/**
 * cellId -> the single highest-priority layer lighting it, for every cell
 * lit by ANY layer right now. Same priority order as resolveCell (hover >
 * pinned > context), so a cell lit by both hover and context only ever
 * shows up once, tagged with "hover".
 */
export function litCellsById(state: HighlightState): Partial<Record<CellId, Layer>> {
  const result: Partial<Record<CellId, Layer>> = {};
  for (const layer of LAYER_PRIORITY) {
    const set = state[layer];
    if (!set) continue;
    for (const entry of set.entries) {
      if (!(entry.cellId in result)) {
        result[entry.cellId] = layer;
      }
    }
  }
  return result;
}

/** Count of distinct cells lit by any of the three layers, out of 46. */
export function countLitCells(state: HighlightState): number {
  return Object.keys(litCellsById(state)).length;
}
