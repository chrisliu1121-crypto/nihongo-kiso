// KanaTable — the always-present 46-cell gojuon table. Purely a display of
// the current highlight state (via useCellState); it never calls
// setLayer/togglePinned itself. Highlighting can only ever be triggered by
// a Token (DESIGN.md §5.1/§6).

import { useLayoutEffect, useRef, useState } from "react";
import kanaData from "../../data/kana.json";
import type { CellId, CellMark, KanaCell } from "../lib/kana";
import { getState, type Layer } from "../store/highlight";
import { useCellState, useHighlightState } from "../store/useHighlight";

const TABLE = kanaData as unknown as {
  rows: string[];
  cols: string[];
  cells: KanaCell[];
};

const CELLS_BY_ROW_COL = new Map<string, KanaCell>();
let N_CELL: KanaCell | null = null;
for (const cell of TABLE.cells) {
  if (cell.id === "n") {
    N_CELL = cell;
    continue;
  }
  CELLS_BY_ROW_COL.set(`${cell.row}|${cell.col}`, cell);
}

// ①..⑳ (U+2460-U+2473, a contiguous run) -- no word gets anywhere near 20
// morae, but this is cheap to make generous. Past that, fall back to "(n)".
const CIRCLED_DIGITS = Array.from({ length: 20 }, (_, i) => String.fromCodePoint(0x2460 + i));
function orderBadge(order: number): string {
  const n = order + 1;
  return n <= CIRCLED_DIGITS.length ? CIRCLED_DIGITS[n - 1] : `(${n})`;
}

function markBadge(mark: CellMark): string | null {
  switch (mark) {
    case "sokuon":
      return "促";
    case "chouon":
      return "長";
    case "small":
      return "小";
    default:
      return null; // dakuten/handakuten/out_of_table are drawn separately
  }
}

const CELL_STATE_CLASSES: Record<Layer | "idle", string> = {
  idle: "border-stone-200 bg-white text-stone-700",
  context: "border-amber-200 bg-amber-50 text-stone-700",
  pinned: "border-amber-400 bg-amber-100 text-stone-900",
  hover: "border-amber-500 bg-amber-200 text-stone-900 shadow-sm",
};

interface CellViewProps {
  cell: KanaCell;
  registerRef: (id: CellId, el: HTMLDivElement | null) => void;
  compact?: boolean;
}

function CellView({ cell, registerRef, compact }: CellViewProps) {
  const resolved = useCellState(cell.id);
  const layerClass = CELL_STATE_CLASSES[resolved.layer ?? "idle"];
  const hasDakuten = resolved.marks.includes("dakuten");
  const hasHandakuten = resolved.marks.includes("handakuten");
  const otherMarks = resolved.marks
    .map(markBadge)
    .filter((m): m is string => m !== null);

  return (
    <div
      ref={(el) => registerRef(cell.id, el)}
      data-cell-id={cell.id}
      aria-label={`${cell.hiragana} ${cell.romaji}`}
      className={`relative flex flex-col items-center justify-center rounded-md border transition-all duration-150 ${
        compact ? "h-12 w-12" : "h-16 w-16"
      } ${layerClass}`}
      style={{ opacity: resolved.dimmed ? 0.4 : 1 }}
    >
      {resolved.orders.length > 0 && (
        <span className="absolute -right-1 -top-1 text-[11px] leading-none text-amber-700">
          {resolved.orders.map(orderBadge).join("")}
        </span>
      )}
      {(hasDakuten || hasHandakuten) && (
        <span className="absolute left-1 top-0 text-[10px] leading-none text-stone-500">
          {hasDakuten ? "゛" : "゜"}
        </span>
      )}
      <span className={compact ? "text-lg font-medium" : "text-2xl font-medium"}>
        {cell.hiragana}
      </span>
      <span className={compact ? "text-[9px] text-stone-500" : "text-xs text-stone-500"}>
        {cell.romaji}
      </span>
      {otherMarks.length > 0 && (
        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded bg-stone-700 px-1 text-[8px] leading-tight text-white">
          {otherMarks.join(" ")}
        </span>
      )}
    </div>
  );
}

interface EmptyCellProps {
  compact?: boolean;
}

function EmptyCell({ compact }: EmptyCellProps) {
  return (
    <div
      aria-hidden="true"
      className={`rounded-md border border-dashed border-stone-200 ${compact ? "h-12 w-12" : "h-16 w-16"}`}
    />
  );
}

interface LineSpec {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function sameLine(a: LineSpec, b: LineSpec): boolean {
  return a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2;
}

function sameLines(a: LineSpec[], b: LineSpec[]): boolean {
  if (a.length !== b.length) return false;
  const byKeyA = new Map(a.map((l) => [l.key, l]));
  for (const lineB of b) {
    const lineA = byKeyA.get(lineB.key);
    if (!lineA || !sameLine(lineA, lineB)) return false;
  }
  return true;
}

export interface KanaTableProps {
  /** Smaller cells, for a future mobile layout. Not used by the demo yet. */
  compact?: boolean;
}

export function KanaTable({ compact = false }: KanaTableProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const cellRefs = useRef(new Map<CellId, HTMLDivElement>());
  const [lines, setLines] = useState<LineSpec[]>([]);

  // Re-render whenever the store changes, purely so the layout effect below
  // re-runs and recomputes yoon connector lines against the new state.
  useHighlightState();

  const registerRef = (id: CellId, el: HTMLDivElement | null) => {
    if (el) cellRefs.current.set(id, el);
    else cellRefs.current.delete(id);
  };

  useLayoutEffect(() => {
    const computeLines = () => {
      const svg = svgRef.current;
      if (!svg) return;
      // Use the svg element's OWN rect as the coordinate origin, not the
      // wrapper's: the svg is absolutely positioned at the wrapper's
      // padding edge (inset 0 of a `position: relative` ancestor sits
      // inside any border), so if the wrapper ever grows a border, using
      // wrapperRect directly would offset every line by the border width.
      // The svg's own rect is exactly where (0,0) in its coordinate space
      // actually renders, border or no border.
      const originRect = svg.getBoundingClientRect();

      // Group every currently-lit cell's orders by "which layer + which
      // order", so we only connect two cells that were lit by the SAME
      // highlight source at the SAME mora -- never two unrelated tokens
      // that happen to share an order number. context is deliberately
      // excluded: it's pale-background-only (no badges, no connector
      // lines -- DESIGN.md §5.2), same reasoning as resolveCell stripping
      // its orders/marks.
      const groups = new Map<string, { cellId: CellId; hasSmall: boolean }[]>();
      const state = getState();
      for (const cell of TABLE.cells) {
        const layers: Layer[] = ["hover", "pinned"];
        for (const layer of layers) {
          const set = state[layer];
          if (!set) continue;
          const entry = set.entries.find((e) => e.cellId === cell.id);
          if (!entry) continue;
          const hasSmall = entry.marks.includes("small");
          for (const order of entry.orders) {
            const key = `${layer}:${order}`;
            const list = groups.get(key) ?? [];
            list.push({ cellId: cell.id, hasSmall });
            groups.set(key, list);
          }
          break; // a cell only "belongs" to its highest-priority active layer
        }
      }

      const nextLines: LineSpec[] = [];
      for (const [key, members] of groups) {
        if (members.length !== 2) continue;
        if (!members.some((m) => m.hasSmall)) continue;
        const [a, b] = members;
        const elA = cellRefs.current.get(a.cellId);
        const elB = cellRefs.current.get(b.cellId);
        if (!elA || !elB) continue;
        const rectA = elA.getBoundingClientRect();
        const rectB = elB.getBoundingClientRect();
        nextLines.push({
          key,
          x1: rectA.left + rectA.width / 2 - originRect.left,
          y1: rectA.top + rectA.height / 2 - originRect.top,
          x2: rectB.left + rectB.width / 2 - originRect.left,
          y2: rectB.top + rectB.height / 2 - originRect.top,
        });
      }

      setLines((prev) => (sameLines(prev, nextLines) ? prev : nextLines));
    };

    computeLines();

    // Noto Sans JP loads with font-display: swap, so cell text can reflow
    // (changing romaji/hiragana line widths, and therefore cell centers)
    // after the initial layout. Recompute once fonts have actually
    // settled. document.fonts is absent in some SSR/test environments, so
    // guard it rather than assume a browser.
    if (typeof document !== "undefined" && document.fonts) {
      document.fonts.ready.then(computeLines).catch(() => {});
    }

    window.addEventListener("resize", computeLines);
    return () => window.removeEventListener("resize", computeLines);
  });

  const nCell = N_CELL;

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <svg
        ref={svgRef}
        className="pointer-events-none absolute left-0 top-0 h-full w-full overflow-visible"
      >
        {lines.map((line) => (
          <line
            key={line.key}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke="rgb(217 119 6)"
            strokeWidth={2}
            strokeDasharray="4 3"
          />
        ))}
      </svg>

      <table className="border-separate border-spacing-1">
        <thead>
          <tr>
            <th className={compact ? "h-12 w-12" : "h-16 w-16"} />
            {TABLE.cols.map((col) => {
              const headerCell = CELLS_BY_ROW_COL.get(`|${col}`);
              return (
                <th key={col} className="text-center text-sm font-normal text-stone-500">
                  {headerCell?.hiragana ?? col}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {TABLE.rows.map((row) => {
            const headerCell = CELLS_BY_ROW_COL.get(`${row}|a`);
            return (
              <tr key={row || "vowel-row"}>
                <th className="pr-1 text-center text-sm font-normal text-stone-500">
                  {headerCell?.hiragana ?? ""}
                </th>
                {TABLE.cols.map((col) => {
                  const cell = CELLS_BY_ROW_COL.get(`${row}|${col}`);
                  return (
                    <td key={col}>
                      {cell ? (
                        <CellView cell={cell} registerRef={registerRef} compact={compact} />
                      ) : (
                        <EmptyCell compact={compact} />
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      {nCell && (
        <div className="mt-2 flex items-center gap-2 border-t border-dashed border-stone-300 pt-2">
          <span className="text-xs text-stone-400">單獨一格：</span>
          <CellView cell={nCell} registerRef={registerRef} compact={compact} />
        </div>
      )}
    </div>
  );
}
