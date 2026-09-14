// ReviewPanel — the "題目清單" collapsible review menu shared by
// PracticeArrange/PracticeParticle (user feedback: "出過的...題目不能消失，
// 要有...回顧選單"). Groups exercises by `batch` (Exercise.batch, seed data
// has none -> falls back to SEED_BATCH_LABEL), lists them in order, and lets
// the learner jump straight to any question. The current question is
// highlighted.
//
// Deliberately plain text, not Token: this is a navigation list, not
// content -- rendering every sentence through Token here would light up the
// gojuon table on hover for every row in the list, drowning out whatever
// the learner is actually looking at in the active question (same "Token is
// the only highlight entry point, but not every japanese-looking string
// needs to BE one" reasoning as ArrangeView's plain-text preferredSurface
// answer reveal).
//
// One panel implementation serves both practice pages: each page computes
// its own per-exercise-type summary string (arrange: prompt_zh; particle
// swap: the sentence's own `ja`) and hands this component a flat, already-
// summarized list -- so this file stays generic over Exercise's union
// instead of needing its own type-narrowing switch.

import { useState } from "react";

export interface ReviewItem {
  id: string;
  batch?: string;
  /** Plain-text summary line (not Token'd -- see header comment). */
  summary: string;
  verified: boolean;
}

export interface ReviewPanelProps {
  items: ReviewItem[];
  currentIndex: number;
  onSelect: (index: number) => void;
}

const SEED_BATCH_LABEL = "種子題組";

interface GroupedItem {
  item: ReviewItem;
  index: number;
}

function groupByBatch(items: ReviewItem[]): [string, GroupedItem[]][] {
  const groups = new Map<string, GroupedItem[]>();
  items.forEach((item, index) => {
    const key = item.batch ?? SEED_BATCH_LABEL;
    const list = groups.get(key) ?? [];
    list.push({ item, index });
    groups.set(key, list);
  });
  return [...groups.entries()];
}

export function ReviewPanel({ items, currentIndex, onSelect }: ReviewPanelProps) {
  // Expanded by default, same as WordBank's date groups -- the whole point
  // is "題目不能消失" (user feedback), so the list should be visible without
  // an extra click on first load. Still collapsible for mobile / once the
  // learner just wants the active question.
  const [open, setOpen] = useState(true);
  const groups = groupByBatch(items);

  return (
    <div className="rounded-xl border border-stone-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium text-stone-700 transition-colors duration-150 hover:bg-amber-50/60"
      >
        <span>題目清單（{items.length} 題）</span>
        <span className="text-xs text-stone-400">{open ? "收合" : "展開"}</span>
      </button>
      {open && (
        <div className="max-h-96 space-y-3 overflow-y-auto border-t border-stone-100 px-4 py-3">
          {groups.map(([batch, groupItems]) => (
            <div key={batch}>
              <p className="mb-1 text-xs font-medium text-stone-400">{batch}</p>
              <ul className="space-y-0.5">
                {groupItems.map(({ item, index }) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(index)}
                      aria-current={index === currentIndex ? "true" : undefined}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors duration-150 ${
                        index === currentIndex
                          ? "bg-amber-100 text-amber-900"
                          : "text-stone-600 hover:bg-amber-50/60"
                      }`}
                    >
                      <span className="shrink-0 text-xs text-stone-400">{index + 1}.</span>
                      <span className="flex-1 truncate">{item.summary}</span>
                      {!item.verified && (
                        <span className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-400">
                          未校對
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
