// GrammarPicker — quick navigation between grammar pages.
//
// - GrammarJumpSelect: a native <select> grouped by category (optgroup);
//   choosing an option navigates straight to that page. Native on purpose:
//   it gets the platform picker on phones and full keyboard support for free.
// - GrammarIndexTable: one row per category, every item a clickable chip with
//   a short hint, plus a row for the verb page.
//
// Both read bank.grammar.items, so a newly authored item shows up here
// without touching this file.

import { Link, useNavigate } from "react-router-dom";
import bank, { itemsByCategory } from "../lib/bank";
import { CATEGORY_DESCRIPTION, CATEGORY_LABEL, CATEGORY_ORDER, VERBS_ROUTE, itemHint } from "../lib/grammar/categories";

const VERBS_VALUE = "__verbs";

export interface GrammarPickerProps {
  /** The grammar item id of the current page, or "verbs" on the verb page. Marks the current entry. */
  currentId?: string;
}

export function GrammarJumpSelect({ currentId }: GrammarPickerProps) {
  const navigate = useNavigate();
  const value = currentId === "verbs" ? VERBS_VALUE : (currentId ?? "");

  return (
    <label className="flex w-full items-center gap-2 text-sm text-stone-600 sm:w-auto">
      <span className="shrink-0">跳到</span>
      <select
        value={value}
        onChange={(event) => {
          const v = event.target.value;
          if (!v) return;
          navigate(v === VERBS_VALUE ? VERBS_ROUTE : `/grammar/${v}`);
        }}
        className="min-h-9 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-xs text-stone-800 shadow-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-200 focus:outline-none sm:w-72"
      >
        <option value="">選擇文法項目…</option>
        {CATEGORY_ORDER.map((cat) => {
          const items = itemsByCategory(bank, cat);
          if (items.length === 0) return null;
          return (
            <optgroup key={cat} label={CATEGORY_LABEL[cat]}>
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.surface}　{itemHint(it)}
                </option>
              ))}
            </optgroup>
          );
        })}
        <optgroup label="動詞">
          <option value={VERBS_VALUE}>五段・一段・不規則　活用表</option>
        </optgroup>
      </select>
    </label>
  );
}

function chipClass(active: boolean): string {
  return `flex min-w-0 flex-col rounded-lg border px-2.5 py-1 leading-tight transition-colors duration-150 ${
    active
      ? "border-amber-400 bg-amber-50"
      : "border-stone-200 bg-white hover:border-amber-300 hover:bg-amber-50/60"
  }`;
}

export function GrammarIndexTable({ currentId }: GrammarPickerProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      {CATEGORY_ORDER.map((cat) => {
        const items = itemsByCategory(bank, cat);
        return (
          <div
            key={cat}
            className="flex flex-col gap-2 border-b border-stone-100 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-4"
          >
            <div className="sm:w-32 sm:shrink-0 sm:pt-1.5">
              <p className="text-sm font-semibold text-stone-700">{CATEGORY_LABEL[cat]}</p>
              <p className="hidden text-[11px] leading-snug text-stone-400 sm:block">{CATEGORY_DESCRIPTION[cat]}</p>
            </div>
            {items.length === 0 ? (
              <p className="text-xs text-stone-400 italic sm:pt-1.5">（尚未收錄）</p>
            ) : (
              <div className="grid flex-1 grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-4">
                {items.map((it) => (
                  <Link
                    key={it.id}
                    to={`/grammar/${it.id}`}
                    aria-current={currentId === it.id ? "page" : undefined}
                    title={`${it.surface}：${it.senses.map((s) => s.label).join("・")}`}
                    className={chipClass(currentId === it.id)}
                  >
                    <span className="text-base font-medium text-stone-800">{it.surface}</span>
                    <span className="truncate text-[11px] text-stone-500">{itemHint(it)}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-4">
        <div className="sm:w-32 sm:shrink-0 sm:pt-1.5">
          <p className="text-sm font-semibold text-stone-700">動詞</p>
          <p className="hidden text-[11px] leading-snug text-stone-400 sm:block">動詞分類與活用</p>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-4">
          <Link
            to={VERBS_ROUTE}
            aria-current={currentId === "verbs" ? "page" : undefined}
            className={chipClass(currentId === "verbs")}
          >
            <span className="text-base font-medium text-stone-800">五段・一段・不規則</span>
            <span className="truncate text-[11px] text-stone-500">ます形・ない形・て形・た形</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
