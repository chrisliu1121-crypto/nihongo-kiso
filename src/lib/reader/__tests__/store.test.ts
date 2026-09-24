import { describe, expect, it } from "vitest";
import {
  createIndexedDBReaderStore,
  createInMemoryReaderStore,
  getReaderStore,
  resetReaderStoreForTests,
  type IndexedDBFactoryLike,
} from "../store";
import type { MyWord, TextDoc } from "../types";

function makeDoc(overrides: Partial<TextDoc> = {}): TextDoc {
  return {
    id: overrides.id ?? "text_1",
    title: overrides.title ?? "測試文本",
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
    source: overrides.source ?? "テスト",
    model: overrides.model ?? "test/model",
    sentences: overrides.sentences ?? [],
    extracted: overrides.extracted ?? { vocab: [], grammar: [], particles: [] },
    status: overrides.status ?? "complete",
    pendingSegments: overrides.pendingSegments ?? [],
  };
}

function makeMyWord(overrides: Partial<MyWord> = {}): MyWord {
  return {
    id: overrides.id ?? "w_1",
    surface: overrides.surface ?? "学校",
    reading: overrides.reading ?? "がっこう",
    gloss: overrides.gloss ?? "學校",
    pos: overrides.pos ?? "名詞",
    note: overrides.note ?? "",
    fromTextId: overrides.fromTextId ?? "text_1",
    fromTextTitle: overrides.fromTextTitle ?? "測試文本",
    addedAt: overrides.addedAt ?? "2026-01-01T00:00:00.000Z",
    romaji: overrides.romaji ?? "gakkou",
  };
}

describe("InMemoryReaderStore: texts", () => {
  it("putText + listTexts sorts newest updatedAt first", async () => {
    const store = createInMemoryReaderStore();
    await store.putText(makeDoc({ id: "a", updatedAt: "2026-01-01T00:00:00.000Z" }));
    await store.putText(makeDoc({ id: "b", updatedAt: "2026-03-01T00:00:00.000Z" }));
    await store.putText(makeDoc({ id: "c", updatedAt: "2026-02-01T00:00:00.000Z" }));

    const list = await store.listTexts();
    expect(list.map((d) => d.id)).toEqual(["b", "c", "a"]);
  });

  it("getText returns undefined for a missing id", async () => {
    const store = createInMemoryReaderStore();
    expect(await store.getText("nope")).toBeUndefined();
  });

  it("deleteText removes it from listTexts", async () => {
    const store = createInMemoryReaderStore();
    await store.putText(makeDoc({ id: "a" }));
    await store.deleteText("a");
    expect(await store.listTexts()).toEqual([]);
  });

  it("a doc written before status/pendingSegments existed is read back normalized to complete/[]", async () => {
    const store = createInMemoryReaderStore();
    const legacy = makeDoc({ id: "legacy" }) as Partial<TextDoc>;
    delete legacy.status;
    delete legacy.pendingSegments;
    await store.putText(legacy as TextDoc);

    const read = await store.getText("legacy");
    expect(read?.status).toBe("complete");
    expect(read?.pendingSegments).toEqual([]);

    const listed = await store.listTexts();
    expect(listed[0].status).toBe("complete");
    expect(listed[0].pendingSegments).toEqual([]);
  });
});

describe("InMemoryReaderStore: myWords", () => {
  it("addMyWord dedupes by surface+reading, returning the existing word instead of adding a duplicate", async () => {
    const store = createInMemoryReaderStore();
    const first = await store.addMyWord({
      surface: "学校",
      reading: "がっこう",
      gloss: "學校",
      pos: "名詞",
      note: "",
      fromTextId: "text_1",
      fromTextTitle: "測試文本",
      romaji: "gakkou",
    });
    const second = await store.addMyWord({
      surface: "学校",
      reading: "がっこう",
      gloss: "different gloss should be ignored",
      pos: "名詞",
      note: "",
      fromTextId: "text_2",
      fromTextTitle: "另一篇",
      romaji: "gakkou",
    });

    expect(second.id).toBe(first.id);
    const list = await store.listMyWords();
    expect(list).toHaveLength(1);
    expect(list[0].gloss).toBe("學校");
  });

  it("removeMyWord removes it from listMyWords", async () => {
    const store = createInMemoryReaderStore();
    const word = await store.addMyWord({
      surface: "食べる",
      reading: "たべる",
      gloss: "吃",
      pos: "動詞",
      note: "",
      fromTextId: "text_1",
      fromTextTitle: "測試文本",
      romaji: "taberu",
    });
    await store.removeMyWord(word.id);
    expect(await store.listMyWords()).toEqual([]);
  });
});

describe("InMemoryReaderStore: export/import round trip", () => {
  it("exportAll -> importAll into a fresh store reproduces the same texts and words", async () => {
    const source = createInMemoryReaderStore();
    await source.putText(makeDoc({ id: "text_1" }));
    await source.putMyWord(makeMyWord({ id: "w_1" }));

    const payload = await source.exportAll();
    expect(payload.texts).toHaveLength(1);
    expect(payload.myWords).toHaveLength(1);

    const dest = createInMemoryReaderStore();
    const result = await dest.importAll(payload);

    expect(result).toEqual({ textsImported: 1, wordsImported: 1 });
    expect(await dest.getText("text_1")).toEqual(payload.texts[0]);
    expect(await dest.listMyWords()).toEqual(payload.myWords);
  });

  it("import merges by id, newer updatedAt/addedAt wins, older is dropped", async () => {
    const dest = createInMemoryReaderStore();
    await dest.putText(makeDoc({ id: "text_1", title: "舊標題", updatedAt: "2026-01-01T00:00:00.000Z" }));

    const incoming = {
      version: 1 as const,
      exportedAt: "2026-02-01T00:00:00.000Z",
      texts: [makeDoc({ id: "text_1", title: "新標題", updatedAt: "2026-02-01T00:00:00.000Z" })],
      myWords: [],
    };
    const result = await dest.importAll(incoming);
    expect(result.textsImported).toBe(1);
    expect((await dest.getText("text_1"))?.title).toBe("新標題");

    // An older incoming updatedAt must NOT overwrite what's already there.
    const staleIncoming = {
      version: 1 as const,
      exportedAt: "2026-01-15T00:00:00.000Z",
      texts: [makeDoc({ id: "text_1", title: "更舊標題", updatedAt: "2026-01-15T00:00:00.000Z" })],
      myWords: [],
    };
    const result2 = await dest.importAll(staleIncoming);
    expect(result2.textsImported).toBe(0);
    expect((await dest.getText("text_1"))?.title).toBe("新標題");
  });

  it("importAll rejects a malformed payload", async () => {
    const store = createInMemoryReaderStore();
    await expect(store.importAll({ texts: "not-an-array", myWords: [] })).rejects.toThrow();
  });

  it("importAll accepts a payload exported before status/pendingSegments existed, defaulting to complete/[]", async () => {
    const store = createInMemoryReaderStore();
    const doc = makeDoc({ id: "text_1" }) as Partial<TextDoc>;
    delete doc.status;
    delete doc.pendingSegments;

    const result = await store.importAll({ texts: [doc], myWords: [] });
    expect(result.textsImported).toBe(1);
    const imported = await store.getText("text_1");
    expect(imported?.status).toBe("complete");
    expect(imported?.pendingSegments).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// P1 review fix: IndexedDB unavailable/failing must fall back to the
// in-memory store instead of leaving every page's data fetch permanently
// unsettled. Simulated here with a fake IDBFactory whose open() always
// fails asynchronously (like a real rejected/errored IDBOpenDBRequest
// would), since vitest's node environment has no real indexedDB at all.

/** Minimal fake IDBOpenDBRequest that always fires onerror on a later microtask (never onsuccess) -- stands in for a real IndexedDB whose open() fails (private browsing, blocked site data, exhausted quota, ...). */
function makeFailingFactory(): IndexedDBFactoryLike {
  return {
    open() {
      const req = {
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
        error: new Error("simulated indexedDB.open failure"),
      } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => {
        (req.onerror as (() => void) | null)?.();
      });
      return req;
    },
  };
}

describe("IndexedDB open failure falls back to in-memory", () => {
  it("createIndexedDBReaderStore rejects when the injected factory's open() fails", async () => {
    await expect(createIndexedDBReaderStore(makeFailingFactory())).rejects.toThrow();
  });

  it("getReaderStore() falls back to an in-memory store (isPersistent === false) when the global indexedDB's open() rejects", async () => {
    resetReaderStoreForTests();
    const original = (globalThis as { indexedDB?: unknown }).indexedDB;
    (globalThis as { indexedDB?: unknown }).indexedDB = makeFailingFactory();
    try {
      const store = await getReaderStore();
      expect(store.isPersistent).toBe(false);
      // The fallback is still fully functional (not a dead end).
      await store.putText(makeDoc({ id: "still-works" }));
      expect(await store.getText("still-works")).toBeTruthy();
    } finally {
      if (original === undefined) {
        delete (globalThis as { indexedDB?: unknown }).indexedDB;
      } else {
        (globalThis as { indexedDB?: unknown }).indexedDB = original;
      }
      resetReaderStoreForTests();
    }
  });
});
