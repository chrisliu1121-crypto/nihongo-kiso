// src/lib/reader/useReaderStore.ts — small hook so every reader page shares
// the same "wait for the store to resolve" logic instead of each page
// re-deriving it. getReaderStore() itself never rejects (it falls back to
// an in-memory store internally on any IndexedDB failure -- see store.ts),
// so this hook has no error branch of its own; a page still needs its OWN
// try/catch around individual store *operations* (listTexts/getText/...),
// since those can still reject on their own (a full quota, a closed
// connection, ...) even once the store itself opened fine (P1 review fix).

import { useEffect, useState } from "react";
import { getReaderStore, type ReaderStore } from "./store.ts";

/** null while the store is still resolving (first paint); resolves to the shared ReaderStore right after (real IndexedDB, or the in-memory fallback -- check `.isPersistent`). */
export function useReaderStore(): ReaderStore | null {
  const [store, setStore] = useState<ReaderStore | null>(null);

  useEffect(() => {
    let cancelled = false;
    getReaderStore().then((resolved) => {
      if (!cancelled) setStore(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return store;
}
