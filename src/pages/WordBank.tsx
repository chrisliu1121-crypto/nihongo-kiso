// WordBank — the "/bank" 單詞庫頁 (user feedback: "出過的單詞...不能消失，
// 要有單詞庫頁"). Unlike DailyWords (one day at a time), this lists every
// day's words at once, most recent day first, with a live text filter.
//
// Same Token-only-highlight-entry rule as WordCard: this page never calls
// setLayer/togglePinned/clearLayer itself, only renders Token instances.

import { useMemo, useState } from "react";
import { Token } from "../components/Token";
import bank, { filterWords } from "../lib/bank";
import type { Word } from "../lib/bank";

interface WordRowProps {
  word: Word;
}

function WordRow({ word }: WordRowProps) {
  return (
    <div className="flex flex-col gap-2 border-b border-stone-100 py-3 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Token
          surface={word.surface}
          reading={word.reading}
          gloss={word.gloss}
          role={word.pos === "動詞" ? "verb" : "noun"}
          size="md"
          id={word.id}
        />
        <div className="mt-1 flex shrink-0 items-center gap-1.5">
          {!word.verified && (
            <span
              className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-600"
              title="這個詞尚未通過第二次獨立審查（DESIGN.md §9.3），內容可能有誤"
            >
              未校對
            </span>
          )}
          <span className="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-500">{word.pos}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-1.5">
        {word.example.tokens.map((token, i) => (
          <Token
            key={i}
            surface={token.surface}
            reading={token.reading}
            gloss={token.gloss}
            glossMode="hover"
            particle={token.particle}
            role={token.particle ? "particle" : "phrase"}
            size="sm"
            id={`${word.id}:bank-ex:${i}`}
          />
        ))}
      </div>
      <p className="text-xs text-stone-400">{word.example.zh}</p>
    </div>
  );
}

interface DayGroup {
  date: string;
  words: Word[];
}

export function WordBank() {
  const [query, setQuery] = useState("");
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(() => new Set());

  // bank.days is ascending (scripts/build-bank.ts sorts it that way) --
  // reverse for "最新在上". Filter each day's own words rather than the
  // flat bank.words list so the per-day grouping survives filtering.
  const groups: DayGroup[] = useMemo(() => {
    const descending = [...bank.days].reverse();
    return descending
      .map((day) => ({ date: day.date, words: filterWords(day.words, query) }))
      .filter((g) => g.words.length > 0);
  }, [query]);

  const totalWords = groups.reduce((sum, g) => sum + g.words.length, 0);
  const totalDays = groups.length;

  function toggleDate(date: string): void {
    setCollapsedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-stone-900">單詞庫</h1>
        <span className="ml-auto text-sm text-stone-500">
          共 {totalWords} 詞 · {totalDays} 天
        </span>
      </header>

      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜尋漢字、假名、羅馬字或中文意思..."
        aria-label="搜尋單詞"
        className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 transition-colors duration-150 focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-200"
      />

      {bank.days.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 bg-white p-6 text-sm text-stone-500">
          尚未建置單詞資料庫。請先執行{" "}
          <code className="rounded bg-stone-100 px-1 py-0.5">npm run build:bank</code>。
        </p>
      ) : groups.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 bg-white p-6 text-sm text-stone-500">
          沒有符合的詞
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => {
            const isCollapsed = collapsedDates.has(group.date);
            return (
              <section
                key={group.date}
                className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => toggleDate(group.date)}
                  aria-expanded={!isCollapsed}
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium text-stone-700 transition-colors duration-150 hover:bg-amber-50/60"
                >
                  <span>
                    {group.date}（{group.words.length} 詞）
                  </span>
                  <span className="text-xs text-stone-400">{isCollapsed ? "展開" : "收合"}</span>
                </button>
                {!isCollapsed && (
                  <div className="border-t border-stone-100 px-4">
                    {group.words.map((word) => (
                      <WordRow key={word.id} word={word} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
