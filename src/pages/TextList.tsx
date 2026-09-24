// TextList — "/texts": every analyzed text on this device, most recently
// updated first. Mirrors WordBank.tsx's "load from local store, empty state
// explains what to do" shape, but reads from src/lib/reader/store.ts
// (IndexedDB) instead of the pre-built data/bank.json.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useReaderStore } from "../lib/reader/useReaderStore";
import { PersistenceWarning } from "../components/PersistenceWarning";
import { getStoredApiKey } from "../lib/reader/settings";
import type { TextDoc } from "../lib/reader/types";

export function TextList() {
  const store = useReaderStore();
  const [texts, setTexts] = useState<TextDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(true);

  useEffect(() => {
    setHasKey(getStoredApiKey().trim() !== "");
  }, []);

  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    store
      .listTexts()
      .then((list) => {
        if (!cancelled) setTexts(list);
      })
      .catch((err) => {
        // P1 review fix: a rejected listTexts() used to leave `texts` at
        // `null` forever, so the page just showed "載入中..." indefinitely.
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [store]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-stone-900">閱讀</h1>
        <Link
          to="/texts/new"
          className="ml-auto rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
        >
          新增文本
        </Link>
      </header>

      {store && !store.isPersistent && <PersistenceWarning />}

      {!hasKey && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          還沒有設定 OpenRouter key，請先到{" "}
          <Link to="/settings" className="font-medium underline">
            設定
          </Link>{" "}
          頁輸入。
        </p>
      )}

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">讀取文本列表失敗：{error}</p>
      ) : texts === null ? (
        <p className="text-sm text-stone-400">載入中...</p>
      ) : texts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 bg-white p-6 text-sm text-stone-500">
          貼上一段日文文章或歌詞，AI 會幫你逐句拆解、標羅馬字、翻譯，並整理常見詞彙、文法與助詞——按右上角「新增文本」開始。
        </p>
      ) : (
        <ul className="space-y-2">
          {texts.map((doc) => (
            <li key={doc.id}>
              <Link
                to={`/texts/${doc.id}`}
                className="block rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition-colors duration-150 hover:border-amber-300 hover:bg-amber-50/40"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-medium text-stone-800">
                    {doc.title}
                    {doc.status === "partial" && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-700">
                        未完成
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-stone-400">
                    {new Date(doc.updatedAt).toLocaleDateString()} · {doc.sentences.length} 句
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
