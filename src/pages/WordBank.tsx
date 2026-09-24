// WordBank — the "/bank" 單詞庫頁 (user feedback: "出過的單詞...不能消失，
// 要有單詞庫頁"). Unlike DailyWords (one day at a time), this lists every
// day's words at once, most recent day first, with a live text filter.
//
// Same Token-only-highlight-entry rule as WordCard: this page never calls
// setLayer/togglePinned/clearLayer itself, only renders Token instances.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Token } from "../components/Token";
import { PersistenceWarning } from "../components/PersistenceWarning";
import bank, { filterWords } from "../lib/bank";
import type { Word } from "../lib/bank";
import { useReaderStore } from "../lib/reader/useReaderStore";
import type { MyWord } from "../lib/reader/types";

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

/** True if `query` (case-insensitive, trimmed) is a substring of any of `word`'s searchable text: surface, reading, romaji, gloss. Same shape as search.ts's matchesWord, for the device-local "我的單字" list (which isn't part of the pre-built bank, so it can't reuse Word's own romaji_ascii field). */
function matchesMyWord(word: MyWord, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    word.surface.toLowerCase().includes(q) ||
    word.reading.toLowerCase().includes(q) ||
    word.romaji.toLowerCase().includes(q) ||
    word.gloss.toLowerCase().includes(q)
  );
}

interface MyWordRowProps {
  word: MyWord;
  onRemove: (id: string) => void;
}

function MyWordRow({ word, onRemove }: MyWordRowProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <Token surface={word.surface} reading={word.reading} romaji={word.romaji} gloss={word.gloss} size="md" id={`myword:${word.id}`} />
        <Link to={`/texts/${word.fromTextId}`} className="text-xs text-stone-400 underline hover:text-amber-700">
          出自：{word.fromTextTitle}
        </Link>
      </div>
      <button
        type="button"
        onClick={() => onRemove(word.id)}
        className="shrink-0 rounded-lg border border-stone-200 px-2 py-1 text-xs text-stone-500 hover:bg-red-50 hover:text-red-600"
      >
        刪除
      </button>
    </div>
  );
}

export function WordBank() {
  const store = useReaderStore();
  const [query, setQuery] = useState("");
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(() => new Set());
  const [myWords, setMyWords] = useState<MyWord[]>([]);
  const [myWordsError, setMyWordsError] = useState<string | null>(null);

  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    store
      .listMyWords()
      .then((list) => {
        if (!cancelled) setMyWords(list);
      })
      .catch((err) => {
        // P1 review fix: a rejected listMyWords() used to leave `myWords`
        // at [] forever with no indication anything went wrong.
        if (!cancelled) setMyWordsError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [store]);

  async function handleRemoveMyWord(id: string): Promise<void> {
    if (!store) return;
    try {
      await store.removeMyWord(id);
      setMyWords((prev) => prev.filter((w) => w.id !== id));
    } catch (err) {
      setMyWordsError(err instanceof Error ? err.message : String(err));
    }
  }

  const filteredMyWords = useMemo(() => myWords.filter((w) => matchesMyWord(w, query)), [myWords, query]);

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

      {store && !store.isPersistent && <PersistenceWarning />}
      {myWordsError && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          讀取「我的單字」失敗：{myWordsError}
        </p>
      )}

      {myWords.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
          <h2 className="px-4 pt-3 text-sm font-semibold text-stone-700">
            我的單字 <span className="font-normal text-stone-400">（{filteredMyWords.length}）</span>
          </h2>
          {filteredMyWords.length === 0 ? (
            <p className="px-4 py-3 text-sm text-stone-400">沒有符合的詞</p>
          ) : (
            <div className="px-4 pb-1">
              {filteredMyWords.map((w) => (
                <MyWordRow key={w.id} word={w} onRemove={(id) => void handleRemoveMyWord(id)} />
              ))}
            </div>
          )}
        </section>
      )}

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
