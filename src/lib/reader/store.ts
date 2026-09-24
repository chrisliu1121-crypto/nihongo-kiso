// src/lib/reader/store.ts — local-only storage for the "閱讀" feature:
// texts (TextDoc) and the user's picked words (MyWord). Nothing here is
// ever sent to a server or committed to the repo (user decision, see the
// build task's own spec: "只存本機").
//
// Split into an interface (ReaderStore) plus two implementations:
//   - IndexedDBReaderStore: the real one, used by the app in the browser.
//   - InMemoryReaderStore: used by tests (vitest's `environment: "node"`
//     has no `indexedDB` global at all) and as a graceful fallback if
//     IndexedDB is ever unavailable (e.g. a locked-down browser profile).
// getReaderStore() picks whichever is available at call time.

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
  listTexts(): Promise<TextDoc[]>;
  getText(id: string): Promise<TextDoc | undefined>;
  putText(doc: TextDoc): Promise<void>;
  deleteText(id: string): Promise<void>;

  listMyWords(): Promise<MyWord[]>;
  /** Adds a word, deduped by surface+reading -- if a word with the same surface+reading already exists, that existing word is returned unchanged (not re-added, not overwritten). */
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
  sentence_index: z.number().int(),
});
const ExtractedParticleSchema = z.object({
  surface: z.string(),
  usage: z.string(),
  sentence_index: z.number().int(),
});

const ExtractedSchema = z.object({
  vocab: z.array(ExtractedVocabSchema),
  grammar: z.array(ExtractedGrammarSchema),
  particles: z.array(ExtractedParticleSchema),
});

const TextDocSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  source: z.string(),
  model: z.string(),
  sentences: z.array(ReaderSentenceSchema),
  extracted: ExtractedSchema,
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
// environment) and as a fallback.

export function createInMemoryReaderStore(): ReaderStore {
  const texts = new Map<string, TextDoc>();
  const words = new Map<string, MyWord>();

  const store: ReaderStore = {
    async listTexts() {
      return [...texts.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    },
    async getText(id) {
      return texts.get(id);
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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TEXTS_STORE)) db.createObjectStore(TEXTS_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(WORDS_STORE)) db.createObjectStore(WORDS_STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB.open failed"));
  });
}

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

export function createIndexedDBReaderStore(): ReaderStore {
  const dbPromise = openDb();

  async function tx(storeName: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await dbPromise;
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  const store: ReaderStore = {
    async listTexts() {
      const objectStore = await tx(TEXTS_STORE, "readonly");
      const all = (await promisifyRequest(objectStore.getAll())) as TextDoc[];
      return all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    },
    async getText(id) {
      const objectStore = await tx(TEXTS_STORE, "readonly");
      return (await promisifyRequest(objectStore.get(id))) as TextDoc | undefined;
    },
    async putText(doc) {
      const objectStore = await tx(TEXTS_STORE, "readwrite");
      await promisifyRequest(objectStore.put(doc));
    },
    async deleteText(id) {
      const objectStore = await tx(TEXTS_STORE, "readwrite");
      await promisifyRequest(objectStore.delete(id));
    },
    async listMyWords() {
      const objectStore = await tx(WORDS_STORE, "readonly");
      const all = (await promisifyRequest(objectStore.getAll())) as MyWord[];
      return all.sort((a, b) => (a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0));
    },
    async addMyWord(input) {
      const existing = await store.listMyWords();
      const dup = existing.find((w) => w.surface === input.surface && w.reading === input.reading);
      if (dup) return dup;
      const word: MyWord = {
        ...input,
        id: input.id ?? generateWordId(),
        addedAt: input.addedAt ?? new Date().toISOString(),
      };
      const objectStore = await tx(WORDS_STORE, "readwrite");
      await promisifyRequest(objectStore.put(word));
      return word;
    },
    async removeMyWord(id) {
      const objectStore = await tx(WORDS_STORE, "readwrite");
      await promisifyRequest(objectStore.delete(id));
    },
    async putMyWord(word) {
      const objectStore = await tx(WORDS_STORE, "readwrite");
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
// (vitest, or a browser profile with IndexedDB disabled). Memoized so every
// caller in the app shares the same store instance (and therefore the same
// underlying IDBDatabase connection / in-memory Maps).

let singleton: ReaderStore | undefined;

export function getReaderStore(): ReaderStore {
  if (!singleton) {
    singleton = typeof indexedDB !== "undefined" ? createIndexedDBReaderStore() : createInMemoryReaderStore();
  }
  return singleton;
}

/** Test-only: force the next getReaderStore() call to build a fresh store. */
export function resetReaderStoreForTests(): void {
  singleton = undefined;
}
