// React binding for the highlight store (highlight.ts is pure TS, no React
// import there on purpose -- keep this file as the only place that touches
// useSyncExternalStore).

import { useCallback, useRef, useSyncExternalStore } from "react";
import { getState, subscribe, resolveCell } from "./highlight";
import type { HighlightState, ResolvedCell } from "./highlight";
import type { CellId } from "../lib/kana";

/** Raw three-layer state, for things that need to know about a whole set (e.g. "am I pinned"). */
export function useHighlightState(): HighlightState {
  return useSyncExternalStore(subscribe, getState, getState);
}

const IDLE_CELL: ResolvedCell = { layer: null, orders: [], marks: [], dimmed: false };

function sameArray<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function sameResolvedCell(a: ResolvedCell, b: ResolvedCell): boolean {
  return (
    a.layer === b.layer &&
    a.dimmed === b.dimmed &&
    sameArray(a.orders, b.orders) &&
    sameArray(a.marks, b.marks)
  );
}

/**
 * One gojuon-table cell's resolved highlight state. The selector result is
 * cached (by content, not just recomputed and returned) so getSnapshot
 * keeps returning the SAME object reference across renders whenever
 * nothing about this particular cell changed -- required by
 * useSyncExternalStore, which otherwise treats a fresh object every render
 * as "the store changed" and re-renders forever.
 */
export function useCellState(cellId: CellId): ResolvedCell {
  const cacheRef = useRef<ResolvedCell>(IDLE_CELL);

  const getSnapshot = useCallback(() => {
    const next = resolveCell(getState(), cellId);
    if (sameResolvedCell(cacheRef.current, next)) return cacheRef.current;
    cacheRef.current = next;
    return next;
  }, [cellId]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
