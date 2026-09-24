// KanaDrawer — the mobile (< lg) replacement for Layout.tsx's sticky
// <aside><KanaTable/></aside> (DESIGN.md §2.1: "行動版為底部抽屜，收合時剩
// 一條「已點亮 n/46」的細條，展開才是整張表"). Rendered by Layout.tsx
// instead of the aside, never alongside it (see useMediaQuery.ts / Layout's
// own comment on why: two mounted KanaTables would fight over the same
// cellRefs-keyed DOM for the yoon connector lines).
//
// This is purely a READER of the highlight store (via useHighlightState /
// store/summary.ts's countLitCells+litCellsById) plus a local UI toggle
// (expanded). It never mutates any highlight-store layer itself -- same
// rule as KanaTable's own header comment ("it never calls the store's own
// layer-writing functions"), extended to this file. Pinning a Token must
// NOT force the drawer open (spec: "釘選不強制彈開") -- only the collapsed
// strip's dot matrix / count react to that.

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import kanaData from "../../data/kana.json";
import type { CellId, KanaCell } from "../lib/kana";
import type { Layer } from "../store/highlight";
import { setOpen, useKanaPanelOpen } from "../store/kanaPanel";
import { countLitCells, litCellsById } from "../store/summary";
import { useHighlightState } from "../store/useHighlight";
import { KanaTable } from "./KanaTable";

const TABLE = kanaData as unknown as {
  rows: string[];
  cols: string[];
  cells: KanaCell[];
};

const CELLS_BY_ROW_COL = new Map<string, CellId>();
for (const cell of TABLE.cells) {
  if (cell.id === "n") continue;
  CELLS_BY_ROW_COL.set(`${cell.row}|${cell.col}`, cell.id);
}

// The main KanaTable draws 10 rows (consonant) x 5 cols (vowel) because
// it's read top-to-bottom by consonant row (DESIGN.md §2.1). A 48px-tall
// bottom strip has no vertical room for 10 rows of dots, so the mini
// matrix here is TRANSPOSED to 5 rows x 10 cols -- wide and short instead
// of tall and narrow. や/わ row gaps stay empty (same "the table's shape
// is itself a memory cue" reasoning as the full table). ん has no row/col
// in kana.json (it's drawn in its own separate strip below the main
// table too) so it isn't part of this grid; it's appended as dot 46/46
// after it.
const DOT_GRID: (CellId | null)[][] = TABLE.cols.map((col) =>
  TABLE.rows.map((row) => CELLS_BY_ROW_COL.get(`${row}|${col}`) ?? null),
);

function dotClass(layer: Layer | undefined): string {
  if (layer === "hover" || layer === "pinned") return "bg-amber-500";
  if (layer === "context") return "bg-amber-300";
  return "bg-stone-300";
}

function Dot({ cellId, layer }: { cellId: CellId; layer: Layer | undefined }) {
  return (
    <span
      aria-hidden="true"
      data-dot-id={cellId}
      className={`h-1.5 w-1.5 rounded-full ${dotClass(layer)}`}
    />
  );
}

/** 46-dot summary of the current highlight state -- read-only, decorative (aria-hidden as a whole; the "已亮 n/46" text next to it carries the accessible count). */
function MiniDotMatrix() {
  const state = useHighlightState();
  const lit = litCellsById(state);

  return (
    <div className="flex items-center gap-1.5" aria-hidden="true">
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `repeat(${TABLE.rows.length}, minmax(0, 1fr))` }}
      >
        {DOT_GRID.map((row, ri) =>
          row.map((cellId, ci) =>
            cellId ? (
              <Dot key={`${ri}-${ci}`} cellId={cellId} layer={lit[cellId]} />
            ) : (
              <span key={`${ri}-${ci}`} className="h-1.5 w-1.5" />
            ),
          ),
        )}
      </div>
      <span className="h-3 w-px shrink-0 bg-stone-300" />
      <Dot cellId="n" layer={lit.n} />
    </div>
  );
}

export function KanaDrawer() {
  // Expanded/collapsed now lives in the kanaPanel store (build task 2026-09
  // "五十音練習") instead of a local useState, so opening the mobile drawer
  // records the same "peeked" signal PracticeKana.tsx reads on desktop
  // (routes/Layout.tsx's collapsed card). Behavior here is unchanged --
  // still a plain boolean, still toggled the same way.
  const expanded = useKanaPanelOpen();
  const [recalcKey, setRecalcKey] = useState(0);
  const highlightState = useHighlightState();
  const litCount = countLitCells(highlightState);

  // Esc collapses (spec: "Esc 收回"). Only listens while expanded.
  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  return (
    <>
      {expanded && (
        // Dim scrim behind the drawer, above everything else. Tapping it
        // collapses (spec). Below the drawer's own z-20.
        <div
          aria-hidden="true"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-10 bg-black/20"
        />
      )}

      <div
        className="fixed inset-x-0 bottom-0 z-20 border-t border-[#e6dccb] bg-[#f5efe3] shadow-[0_-1px_3px_rgba(68,64,60,0.08)]"
        style={
          {
            paddingBottom: "env(safe-area-inset-bottom)",
            // Single source of truth for the 70vh-derived cap, shared by
            // both the outer animated-max-height wrapper below AND the
            // inner scroller (bug fix: the inner div previously used
            // `h-full`, which resolves against the OUTER div's own height
            // -- and that outer height is itself `auto` (only its
            // max-height is set), so percentage heights against it also
            // resolve to `auto` per CSS. The inner div ended up exactly as
            // tall as KanaTable, i.e. never actually height-constrained,
            // so it had nothing to scroll -- the outer `overflow-hidden`
            // was silently CLIPPING the excess instead of the inner
            // `overflow-y-auto` ever getting a chance to scroll it into
            // view. Giving the inner scroller this same cap as an explicit
            // max-height fixes that: it now has a real bounded height of
            // its own to scroll within.
            "--drawer-cap": "calc(70vh - 3rem)",
          } as CSSProperties
        }
      >
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setOpen(!expanded)}
          className="flex h-12 w-full items-center gap-3 px-4 text-left"
        >
          <span className="shrink-0 text-xs font-semibold text-stone-700">五十音</span>
          <span className="shrink-0 text-xs text-stone-500">
            已亮 {litCount}/46
          </span>
          <span className="flex min-w-0 flex-1 items-center justify-center overflow-hidden">
            <MiniDotMatrix />
          </span>
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className={`h-4 w-4 shrink-0 text-stone-500 transition-transform duration-200 motion-reduce:transition-none ${
              expanded ? "rotate-180" : ""
            }`}
          >
            <path
              d="M5 7l5 6 5-6"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {/*
          max-height transition instead of the more obvious translateY: the
          expanded content's real height depends on KanaTable's rendered
          size, which we don't know ahead of the animation without an extra
          measurement pass (and DESIGN.md's own note on this task warns
          that coordinates measured MID-transition drift -- exactly the
          failure mode a translateY-to-a-measured-pixel-value approach would
          hit). Animating between two fixed max-height values (0 and the
          70vh-derived cap below) sidesteps that: no measurement needed
          before the animation starts, and the drawer still visibly grows
          from the bottom.
        */}
        <div
          onTransitionEnd={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.propertyName !== "max-height") return;
            if (!expanded) return;
            // KanaTable's own layout effect recomputes on every render
            // already (no dependency array); bumping this just forces one
            // more render once the drawer has finished growing, so the
            // yoon connector lines are measured against final geometry.
            setRecalcKey((k) => k + 1);
          }}
          className={`overflow-hidden transition-[max-height] duration-200 ease-out motion-reduce:transition-none ${
            expanded ? "max-h-[var(--drawer-cap)]" : "max-h-0"
          }`}
        >
          <div className="flex max-h-[var(--drawer-cap)] justify-center overflow-y-auto overscroll-contain px-3 pb-3 pt-1">
            {expanded && <KanaTable compact recalcKey={recalcKey} />}
          </div>
        </div>
      </div>
    </>
  );
}
