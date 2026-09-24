import { describe, expect, it } from "vitest";
import { createInMemoryReaderStore } from "../store";
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
});
