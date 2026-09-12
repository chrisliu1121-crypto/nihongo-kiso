// Three-layer highlight store for the gojuon table.
//
// Pure TS, zero React imports (see useHighlight.ts for the hook wrapper).
// A module-level singleton: the whole site shares one kana table, so there
// is exactly one hover/pinned/context state, not one per component.
//
// Layer semantics (DESIGN.md §5.2):
//   hover   — transient, highest priority, set by whatever Token is under
//             the pointer/focus right now.
//   pinned  — the token/sentence the user clicked; toggles off on a second
//             click of the SAME source, replaced by a click on a different
//             source.
//   context — background layer for "every kana this exercise touches";
//             lowest priority, no badges.
//
// Token.tsx (src/components/Token.tsx) is the ONLY thing in the app that
// calls setLayer/togglePinned for "hover"/"pinned". The "context" layer may
// also be driven directly by page-level code (e.g. an exercise screen or
// the App.tsx demo's "set context" button) since it isn't tied to a single
// token's pointer/focus/click.

import { kanaToCells } from "../lib/kana";
import type { CellId, CellMark } from "../lib/kana";

export type Layer = "hover" | "pinned" | "context";

export interface HighlightEntry {
  cellId: CellId;
  orders: number[];
  marks: CellMark[];
}

export interface HighlightSet {
  sourceId: string;
  entries: HighlightEntry[];
}

export interface HighlightState {
  hover: HighlightSet | null;
  pinned: HighlightSet | null;
  context: HighlightSet | null;
}

export interface ResolvedCell {
  layer: Layer | null;
  orders: number[];
  marks: CellMark[];
  dimmed: boolean;
}

export interface BuildHighlightSetOptions {
  /** Passed straight through to kanaToCells (§7 particle override). */
  particle?: boolean;
  /** Restrict to a single mora (0-based), e.g. for a per-mora chip hover. */
  moraIndex?: number;
}

/**
 * A mora's `marks` describe the WHOLE mora, not each of its cells
 * individually -- but a two-cell mora (yoon, or a small-vowel extension)
 * has two DIFFERENT cells playing different roles, and a mark belongs to
 * only one of them:
 *   - position 0 (the base cell, e.g. き in きゃ, し in じゃ) can carry
 *     dakuten/handakuten (it's the base kana that's voiced).
 *   - position 1 (the small ゃ/ゅ/ょ or small vowel cell, e.g. や in きゃ)
 *     carries `small` (it's the small kana).
 * A one-cell mora (plain kana, sokuon, chouon, ...) keeps all its marks on
 * its one cell -- there's nothing to split.
 */
function marksForPosition(marks: CellMark[], cellCount: number, position: number): CellMark[] {
  if (cellCount < 2) return marks;
  return position === 0
    ? marks.filter((m) => m === "dakuten" || m === "handakuten")
    : marks.filter((m) => m === "small");
}

/**
 * Turn a reading into a HighlightSet: one entry per distinct cell touched,
 * with per-cell orders (the mora index(es) that lit it up, 0-based -- callers
 * display +1) and the union of the marks that belong to THAT cell (see
 * marksForPosition) across every mora that touched it.
 *
 * A cell hit by more than one mora (ここ -> こ twice) gets ONE entry with
 * both orders, not two entries. A one-mora-two-cell yoon (きゃ) produces two
 * entries that share the same order but carry different marks each.
 */
export function buildHighlightSet(
  sourceId: string,
  reading: string,
  opts?: BuildHighlightSetOptions,
): HighlightSet {
  const morae = kanaToCells(reading, { particle: opts?.particle });
  const selected =
    opts?.moraIndex === undefined ? morae : morae.filter((m) => m.index === opts.moraIndex);

  const byCell = new Map<CellId, HighlightEntry>();
  for (const mora of selected) {
    mora.cells.forEach((cellId, position) => {
      let entry = byCell.get(cellId);
      if (!entry) {
        entry = { cellId, orders: [], marks: [] };
        byCell.set(cellId, entry);
      }
      if (!entry.orders.includes(mora.index)) entry.orders.push(mora.index);
      for (const mark of marksForPosition(mora.marks, mora.cells.length, position)) {
        if (!entry.marks.includes(mark)) entry.marks.push(mark);
      }
    });
  }

  return { sourceId, entries: Array.from(byCell.values()) };
}

let state: HighlightState = { hover: null, pinned: null, context: null };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getState(): HighlightState {
  return state;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setLayer(layer: Layer, set: HighlightSet | null): void {
  if (state[layer] === set) return;
  state = { ...state, [layer]: set };
  emit();
}

export function clearLayer(layer: Layer): void {
  setLayer(layer, null);
}

/** Click semantics: same sourceId as the current pin -> unpin. Otherwise replace. */
export function togglePinned(set: HighlightSet): void {
  if (state.pinned && state.pinned.sourceId === set.sourceId) {
    setLayer("pinned", null);
  } else {
    setLayer("pinned", set);
  }
}

/** Test-only: reset the singleton between test cases. */
export function reset(): void {
  state = { hover: null, pinned: null, context: null };
  emit();
}

const LAYER_PRIORITY: Layer[] = ["hover", "pinned", "context"];

/**
 * Pure lookup: does this cell light up, under which layer, with what
 * badges -- and if it's lit by nothing, is anything else lit right now
 * (dimmed) or is the whole table idle (not dimmed).
 *
 * context is pale-background-only by design (DESIGN.md §5.2: "淡色底，無
 * 徽章") -- its entries still carry real orders/marks (buildHighlightSet
 * doesn't know which layer it'll end up in), but resolveCell strips them
 * here so nothing downstream has to remember "don't draw badges for
 * context": there's simply nothing to draw.
 */
export function resolveCell(highlightState: HighlightState, cellId: CellId): ResolvedCell {
  let anyLayerActive = false;
  for (const layer of LAYER_PRIORITY) {
    const set = highlightState[layer];
    if (!set) continue;
    anyLayerActive = true;
    const entry = set.entries.find((e) => e.cellId === cellId);
    if (entry) {
      if (layer === "context") {
        return { layer, orders: [], marks: [], dimmed: false };
      }
      return { layer, orders: entry.orders, marks: entry.marks, dimmed: false };
    }
  }
  return { layer: null, orders: [], marks: [], dimmed: anyLayerActive };
}
