// PersistenceWarning — shared banner for every 閱讀/單字庫 page that reads
// src/lib/reader/store.ts: shown whenever the resolved ReaderStore fell
// back to the in-memory implementation (IndexedDB missing, or its open()
// failed -- Safari private mode, blocked site data, exhausted quota, ...).
// P1 review fix: previously nothing told the user their data wouldn't
// survive closing the tab.

export function PersistenceWarning() {
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
      這個瀏覽器無法永久儲存，關閉分頁後文本會消失。
    </p>
  );
}
