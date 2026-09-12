// DailyWords — the "今日單詞" page (DESIGN.md §3 `/`, §12 step 3): the
// first real consumer of Token/KanaTable/the highlight store. Renders the
// 10 WordCards for whichever date is selected (defaulting to today), with
// prev/next navigation restricted to days that actually exist in
// data/bank.json so it's never possible to click into a guaranteed-empty
// day.
//
// KanaTable and the lg:flex-row two-column shell used to live here; they
// moved to routes/Layout.tsx in build task 2026-09 step 4 so the table stays
// mounted across every route, not just this one -- this component is now
// only the right-hand "main" content Layout renders into its <Outlet/>.

import { useMemo, useState } from "react";
import { WordCard } from "../components/WordCard";
import bank, { getDay, latestDayBefore, shiftDateKey, todayKey } from "../lib/bank";

export function DailyWords() {
  const [dateKey, setDateKey] = useState(() => todayKey());

  const day = useMemo(() => getDay(bank, dateKey), [dateKey]);
  const prevKey = useMemo(() => shiftDateKey(dateKey, -1), [dateKey]);
  const nextKey = useMemo(() => shiftDateKey(dateKey, 1), [dateKey]);
  const hasPrev = getDay(bank, prevKey) !== undefined;
  const hasNext = getDay(bank, nextKey) !== undefined;
  const isToday = dateKey === todayKey();
  const fallback = useMemo(() => latestDayBefore(bank, dateKey), [dateKey]);

  return (
    <>
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-stone-900">今日單詞</h1>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDateKey(prevKey)}
            disabled={!hasPrev}
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-600 transition-colors duration-150 hover:border-amber-300 hover:bg-amber-50/60 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-stone-200 disabled:hover:bg-white"
          >
            ← 前一天
          </button>
          <span className="min-w-[7rem] text-center text-sm font-medium text-stone-700">
            {dateKey}
          </span>
          <button
            type="button"
            onClick={() => setDateKey(nextKey)}
            disabled={!hasNext}
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-600 transition-colors duration-150 hover:border-amber-300 hover:bg-amber-50/60 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-stone-200 disabled:hover:bg-white"
          >
            後一天 →
          </button>
          <button
            type="button"
            onClick={() => setDateKey(todayKey())}
            disabled={isToday}
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 transition-colors duration-150 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            今天
          </button>
        </div>
      </header>

      {bank.days.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 bg-white p-6 text-sm text-stone-500">
          尚未建置單詞資料庫。請先執行{" "}
          <code className="rounded bg-stone-100 px-1 py-0.5">npm run build:bank</code>。
        </p>
      ) : day ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {day.words.map((word) => (
            <WordCard key={word.id} word={word} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-stone-300 bg-white p-6 text-sm text-stone-500">
          <p>今日詞尚未產生。</p>
          {fallback && (
            <button
              type="button"
              onClick={() => setDateKey(fallback.date)}
              className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 transition-colors duration-150 hover:bg-amber-100"
            >
              看最近一天（{fallback.date}）
            </button>
          )}
        </div>
      )}
    </>
  );
}
