// src/lib/reader/store.ts — local-only storage for the "閱讀" feature:
// texts (TextDoc) and the user's picked words (MyWord). Nothing here is
// ever sent to a server or committed to the repo (user decision, see the
// build task's own spec: "只存本機").
//
// Split into an interface (ReaderStore) plus two implementations:
//   - IndexedDBReaderStore: the real one, used by the app in the browser.
//   - InMemoryReaderStore: used by tests (vitest's `environment: "node"`
//     has no `indexedDB` global at all) and as a graceful fallback when
//     IndexedDB is unavailable or its `open()` fails (Safari private mode,
//     "block all site data" settings, storage quota exhausted, ...) --
//     see getReaderStore()'s own comment: P1 review fix, a page must never
//     get stuck on "載入中" forever just because IndexedDB didn't open.

import { z } from "zod";
import type { Extracted, MyWord, ReaderSentence, TextDoc } from "./types.ts";

const DB_NAME = "nihongo-kiso";
const DB_VERSION = 1;
const TEXTS_STORE = "texts";
const WORDS_STORE = "myWords";

/** Fields the caller supplies when adding a word; id/addedAt are filled in by the store (or supplied by importAll, which needs to preserve the original values). */
export type NewMyWord = Omit<MyWord, "id" | "addedAt"> & Partial<Pick<MyWord, "id" | "addedAt">>;

export interface ExportPayload {
  version: 1;
  exportedAt: string;
  texts: TextDoc[];
  myWords: MyWord[];
}

export interface ImportResult {
  textsImported: number;
  wordsImported: number;
}

export interface ReaderStore {
  /** False for the in-memory fallback: nothing written through this store survives closing the tab. Pages show a warning banner when this is false (P1 review fix). */
  readonly isPersistent: boolean;

  listTexts(): Promise<TextDoc[]>;
  getText(id: string): Promise<TextDoc | undefined>;
  putText(doc: TextDoc): Promise<void>;
  deleteText(id: string): Promise<void>;

  listMyWords(): Promise<MyWord[]>;
  /** Adds a word, deduped by surface+reading -- if a word with the same surface+reading already exists, that existing word is returned unchanged (not re-added, not overwritten). The check-then-write happens inside a single readwrite transaction (P2 review fix: two concurrent calls -- e.g. a double-click -- used to race across two separate transactions and could both pass the dedup check before either wrote). */
  addMyWord(word: NewMyWord): Promise<MyWord>;
  removeMyWord(id: string): Promise<void>;
  /** Upsert-by-id, bypassing the surface+reading dedup addMyWord applies -- used internally by importAll's merge (a same-id row from an import IS this word, not a fresh add), and safe for any other caller that already has a fully-formed MyWord (e.g. re-saving after an edit) and wants exact id semantics. */
  putMyWord(word: MyWord): Promise<void>;

  exportAll(): Promise<ExportPayload>;
  /** Merges `json` into this store: a text/word with an id that already exists is kept only if the incoming one is newer (by updatedAt/addedAt); a new id is always added. Throws if `json` isn't shaped like an ExportPayload. */
  importAll(json: unknown): Promise<ImportResult>;
}

// ---------------------------------------------------------------------------
// zod validation for import (the JSON comes from a file the user picked --
// untrusted input, same trust boundary as scripts/lib/schemas.ts's
// WordFileSchema for a hand-edited day file).

const ReaderTokenSchema = z.object({
  surface: z.string(),
  reading: z.string(),
  gloss: z.string(),
  particle: z.boolean().nullable(),
  romaji: z.string(),
  invalid: z.boolean(),
});

const TranslationChunkSchema = z.object({
  text: z.string(),
  token_indices: z.array(z.number().int()),
});

const ReaderSentenceSchema = z.object({
  tokens: z.array(ReaderTokenSchema),
  translation: z.array(TranslationChunkSchema),
});

const ExtractedVocabSchema = z.object({
  surface: z.string(),
  reading: z.string(),
  gloss: z.string(),
  pos: z.string(),
  note: z.string(),
});
const ExtractedGrammarSchema = z.object({
  pattern: z.string(),
  explanation: z.string(),
  sentence_index: z.number().int().min(0),
});
const ExtractedParticleSchema = z.object({
  surface: z.string(),
  usage: z.string(),
  sentence_index: z.number().int().min(0),
});

const ExtractedSchema = z.object({
  vocab: z.array(ExtractedVocabSchema),
  grammar: z.array(ExtractedGrammarSchema),
  particles: z.array(ExtractedParticleSchema),
});

// status/pendingSegments default when absent so a JSON file exported before
// the P1 "partial doc" fix (or a doc some other older code path wrote)
// still imports cleanly, read as "complete" (nothing pending) -- see
// types.ts's own TextDoc doc comment.
const TextDocSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  source: z.string(),
  model: z.string(),
  sentences: z.array(ReaderSentenceSchema),
  extracted: ExtractedSchema,
  status: z.enum(["complete", "partial"]).default("complete"),
  pendingSegments: z.array(z.string()).default([]),
});

const MyWordSchema = z.object({
  id: z.string(),
  surface: z.string(),
  reading: z.string(),
  gloss: z.string(),
  pos: z.string(),
  note: z.string(),
  fromTextId: z.string(),
  fromTextTitle: z.string(),
  addedAt: z.string(),
  romaji: z.string(),
});

export const ExportPayloadSchema = z.object({
  version: z.number().optional(),
  exportedAt: z.string().optional(),
  texts: z.array(TextDocSchema).default([]),
  myWords: z.array(MyWordSchema).default([]),
});

// Re-exported only for TS callers that want to reference the exact shape (a
// sentence/extracted parsed back off disk) -- keeps store.ts as the single
// place these mirror types.ts's own shapes.
export type { ReaderSentence, Extracted };

function generateWordId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `myword_${crypto.randomUUID()}`;
  }
  return `myword_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Backfills `status`/`pendingSegments` on a TextDoc that was written to
 * IndexedDB before those fields existed (a real record already sitting in a
 * user's browser, not just an import) -- read paths run every doc through
 * this so the rest of the app never has to special-case "undefined status
 * means complete" itself. A no-op for an already-well-formed doc.
 */
function normalizeTextDoc(raw: TextDoc): TextDoc {
  if (raw.status !== undefined && raw.pendingSegments !== undefined) return raw;
  return {
    ...raw,
    status: raw.status ?? "complete",
    pendingSegments: raw.pendingSegments ?? [],
  };
}

/** Shared merge logic for importAll -- works against any ReaderStore (IndexedDB or in-memory) purely through its own interface, so it's written once. */
async function importIntoStore(store: ReaderStore, json: unknown): Promise<ImportResult> {
  const parsed = ExportPayloadSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`匯入檔案格式不正確：${parsed.error.message}`);
  }
  const { texts, myWords } = parsed.data;

  let textsImported = 0;
  for (const doc of texts) {
    const existing = await store.getText(doc.id);
    if (!existing || existing.updatedAt < doc.updatedAt) {
      await store.putText(doc);
      textsImported++;
    }
  }

  let wordsImported = 0;
  const existingWords = await store.listMyWords();
  const existingById = new Map(existingWords.map((w) => [w.id, w]));
  for (const word of myWords) {
    const existing = existingById.get(word.id);
    if (!existing || existing.addedAt < word.addedAt) {
      await store.putMyWord(word);
      wordsImported++;
    }
  }

  return { textsImported, wordsImported };
}

async function buildExport(store: ReaderStore): Promise<ExportPayload> {
  const [texts, myWords] = await Promise.all([store.listTexts(), store.listMyWords()]);
  return { version: 1, exportedAt: new Date().toISOString(), texts, myWords };
}

// ---------------------------------------------------------------------------
// In-memory implementation -- used by tests (no indexedDB in vitest's node
// environment) and as the fallback when IndexedDB is unavailable/fails.

export function createInMemoryReaderStore(): ReaderStore {
  const texts = new Map<string, TextDoc>();
  const words = new Map<string, MyWord>();

  const store: ReaderStore = {
    isPersistent: false,
    async listTexts() {
      return [...texts.values()]
        .map(normalizeTextDoc)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    },
    async getText(id) {
      const doc = texts.get(id);
      return doc ? normalizeTextDoc(doc) : undefined;
    },
    async putText(doc) {
      texts.set(doc.id, doc);
    },
    async deleteText(id) {
      texts.delete(id);
    },
    async listMyWords() {
      return [...words.values()].sort((a, b) => (a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0));
    },
    async addMyWord(input) {
      // Single-threaded JS, no await between the check and the write below --
      // no separate transaction to race across (unlike the IndexedDB
      // implementation before its own P2 fix).
      const dup = [...words.values()].find((w) => w.surface === input.surface && w.reading === input.reading);
      if (dup) return dup;
      const word: MyWord = {
        ...input,
        id: input.id ?? generateWordId(),
        addedAt: input.addedAt ?? new Date().toISOString(),
      };
      words.set(word.id, word);
      return word;
    },
    async removeMyWord(id) {
      words.delete(id);
    },
    async putMyWord(word) {
      words.set(word.id, word);
    },
    async exportAll() {
      return buildExport(store);
    },
    async importAll(json) {
      return importIntoStore(store, json);
    },
  };

  return store;
}

// ---------------------------------------------------------------------------
// IndexedDB implementation.

/** The slice of IDBFactory this module actually calls -- narrowed so tests can inject a fake that fails `.open()` without needing a real IndexedDB polyfill. The real global `indexedDB` satisfies this structurally. */
export interface IndexedDBFactoryLike {
  open(name: string, version?: number): IDBOpenDBRequest;
}

function openDb(factory: IndexedDBFactoryLike): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TEXTS_STORE)) db.createObjectStore(TEXTS_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(WORDS_STORE)) db.createObjectStore(WORDS_STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB.open failed"));
    req.onblocked = () => reject(new Error("indexedDB.open blocked (另一個分頁佔用了較舊版本)"));
  });
}

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

/**
 * Opens (or creates) the IndexedDB database and returns a ReaderStore backed
 * by it. Async and THROWS if `factory.open()` fails or the browser has no
 * `indexedDB` at all -- callers (getReaderStore() below) are expected to
 * catch that and fall back to createInMemoryReaderStore() rather than let a
 * rejected open leave every page stuck on "載入中" (P1 review fix: the
 * previous version built this object synchronously and only discovered an
 * open failure the first time some page happened to call a method on it).
 */
export async function createIndexedDBReaderStore(factory: IndexedDBFactoryLike = indexedDB): Promise<ReaderStore> {
  const db = await openDb(factory);

  function tx(storeName: string, mode: IDBTransactionMode): IDBObjectStore {
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  const store: ReaderStore = {
    isPersistent: true,
    async listTexts() {
      const objectStore = tx(TEXTS_STORE, "readonly");
      const all = (await promisifyRequest(objectStore.getAll())) as TextDoc[];
      return all.map(normalizeTextDoc).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    },
    async getText(id) {
      const objectStore = tx(TEXTS_STORE, "readonly");
      const doc = (await promisifyRequest(objectStore.get(id))) as TextDoc | undefined;
      return doc ? normalizeTextDoc(doc) : undefined;
    },
    async putText(doc) {
      const objectStore = tx(TEXTS_STORE, "readwrite");
      await promisifyRequest(objectStore.put(doc));
    },
    async deleteText(id) {
      const objectStore = tx(TEXTS_STORE, "readwrite");
      await promisifyRequest(objectStore.delete(id));
    },
    async listMyWords() {
      const objectStore = tx(WORDS_STORE, "readonly");
      const all = (await promisifyRequest(objectStore.getAll())) as MyWord[];
      return all.sort((a, b) => (a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0));
    },
    async addMyWord(input) {
      // P2 review fix: the dedup lookup and the write used to be two
      // separate transactions (a listMyWords() call, then later a put() in
      // its own readwrite tx) -- two near-simultaneous addMyWord calls for
      // the SAME surface+reading (e.g. a double-click before the button
      // disables) could both read "no duplicate yet" before either had
      // written, producing two rows. Both steps now run inside one
      // readwrite transaction: getAll() and put() are issued back to back
      // with only synchronous work (the .find() check) between their
      // awaits, so the transaction never auto-commits in between and no
      // other addMyWord call can interleave.
      const objectStore = tx(WORDS_STORE, "readwrite");
      const all = (await promisifyRequest(objectStore.getAll())) as MyWord[];
      const dup = all.find((w) => w.surface === input.surface && w.reading === input.reading);
      if (dup) return dup;
      const word: MyWord = {
        ...input,
        id: input.id ?? generateWordId(),
        addedAt: input.addedAt ?? new Date().toISOString(),
      };
      await promisifyRequest(objectStore.put(word));
      return word;
    },
    async removeMyWord(id) {
      const objectStore = tx(WORDS_STORE, "readwrite");
      await promisifyRequest(objectStore.delete(id));
    },
    async putMyWord(word) {
      const objectStore = tx(WORDS_STORE, "readwrite");
      await promisifyRequest(objectStore.put(word));
    },
    async exportAll() {
      return buildExport(store);
    },
    async importAll(json) {
      return importIntoStore(store, json);
    },
  };

  return store;
}

// ---------------------------------------------------------------------------
// Default selection: real IndexedDB in a browser, in-memory otherwise
// (vitest, or a browser whose IndexedDB is unavailable/fails to open --
// Safari private mode, "block all site data", storage quota exhausted,
// ...). Memoized as a Promise so every caller in the app shares the same
// resolved store instance, and every caller that asks before it resolves
// shares the same in-flight attempt instead of racing to open the DB twice.

let singletonPromise: Promise<ReaderStore> | undefined;

async function buildDefaultStore(): Promise<ReaderStore> {
  if (typeof indexedDB === "undefined") {
    return createInMemoryReaderStore();
  }
  try {
    return await createIndexedDBReaderStore(indexedDB);
  } catch (err) {
    // P1 review fix: IndexedDB existing doesn't mean it WORKS (private
    // browsing, blocked site data, exhausted quota all throw/reject here)
    // -- fall back instead of leaving every page's data-fetching Promise
    // permanently unsettled.
    console.error(
      "[reader/store] IndexedDB 無法使用，改用僅本次分頁有效的記憶體儲存（關閉分頁後這篇文本／單字會消失）：",
      err,
    );
    return createInMemoryReaderStore();
  }
}

/** Resolves to the shared ReaderStore -- real IndexedDB when available and working, otherwise an in-memory fallback (check `.isPersistent` to tell which). Never rejects. */
export function getReaderStore(): Promise<ReaderStore> {
  if (!singletonPromise) {
    singletonPromise = buildDefaultStore();
  }
  return singletonPromise;
}

/** Test-only: force the next getReaderStore() call to build a fresh store. */
export function resetReaderStoreForTests(): void {
  singletonPromise = undefined;
}
