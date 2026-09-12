import { beforeEach, describe, expect, it } from "vitest";
import {
  buildHighlightSet,
  clearLayer,
  getState,
  reset,
  resolveCell,
  setLayer,
  togglePinned,
} from "../highlight";

beforeEach(() => {
  reset();
});

describe("buildHighlightSet", () => {
  it("重複假名合併成一筆 entry、orders 疊加: ここ -> こ 的 orders [0,1]", () => {
    const set = buildHighlightSet("word:here", "ここ");
    expect(set.entries).toEqual([{ cellId: "ko", orders: [0, 1], marks: [] }]);
  });

  it("拗音一拍兩格: きゃ 兩格同 order，但 marks 分屬不同格 -- 基底格不是小字", () => {
    const set = buildHighlightSet("word:kya", "きゃ");
    expect(set.entries).toEqual([
      { cellId: "ki", orders: [0], marks: [] },
      { cellId: "ya", orders: [0], marks: ["small"] },
    ]);
  });

  it("濁音拗音: じゃ -> shi 只有 dakuten、ya 只有 small", () => {
    const set = buildHighlightSet("word:ja", "じゃ");
    expect(set.entries).toEqual([
      { cellId: "shi", orders: [0], marks: ["dakuten"] },
      { cellId: "ya", orders: [0], marks: ["small"] },
    ]);
  });

  it("半濁音拗音: ぴゃ -> hi 只有 handakuten、ya 只有 small", () => {
    const set = buildHighlightSet("word:pya", "ぴゃ");
    expect(set.entries).toEqual([
      { cellId: "hi", orders: [0], marks: ["handakuten"] },
      { cellId: "ya", orders: [0], marks: ["small"] },
    ]);
  });

  it("がっこう: か 有 dakuten、つ 有 sokuon", () => {
    const set = buildHighlightSet("word:gakkou", "がっこう");
    const byCellId = new Map(set.entries.map((e) => [e.cellId, e]));
    expect(byCellId.get("ka")?.marks).toEqual(["dakuten"]);
    expect(byCellId.get("tsu")?.marks).toEqual(["sokuon"]);
  });

  it("moraIndex 給定時只取該拍", () => {
    const set = buildHighlightSet("word:gakkou", "がっこう", { moraIndex: 0 });
    expect(set.entries).toEqual([{ cellId: "ka", orders: [0], marks: ["dakuten"] }]);
  });

  it("particle:true 傳遞到 kanaToCells: は 仍對映 ha 格（顯示 romaji 是另一回事，這裡只管 cellId）", () => {
    const set = buildHighlightSet("particle:ha", "は", { particle: true });
    expect(set.entries).toEqual([{ cellId: "ha", orders: [0], marks: [] }]);
  });
});

describe("三層 store", () => {
  it("各層可獨立設定與清除，互不影響", () => {
    const hoverSet = buildHighlightSet("a", "あ");
    const pinnedSet = buildHighlightSet("i", "い");
    const contextSet = buildHighlightSet("u", "う");

    setLayer("hover", hoverSet);
    setLayer("pinned", pinnedSet);
    setLayer("context", contextSet);
    expect(getState()).toEqual({ hover: hoverSet, pinned: pinnedSet, context: contextSet });

    clearLayer("hover");
    expect(getState()).toEqual({ hover: null, pinned: pinnedSet, context: contextSet });

    clearLayer("pinned");
    expect(getState()).toEqual({ hover: null, pinned: null, context: contextSet });

    clearLayer("context");
    expect(getState()).toEqual({ hover: null, pinned: null, context: null });
  });

  it("togglePinned: 同 sourceId 再次呼叫取消釘選", () => {
    const set = buildHighlightSet("word:x", "え");
    togglePinned(set);
    expect(getState().pinned).toEqual(set);
    togglePinned(set);
    expect(getState().pinned).toBeNull();
  });

  it("togglePinned: 不同 sourceId 替換而非疊加", () => {
    const setA = buildHighlightSet("word:a", "あ");
    const setB = buildHighlightSet("word:b", "い");
    togglePinned(setA);
    togglePinned(setB);
    expect(getState().pinned).toEqual(setB);
  });
});

describe("resolveCell", () => {
  it("優先權 hover > pinned > context：同格在 hover 與 context 時回 hover 的資料", () => {
    setLayer("hover", { sourceId: "h", entries: [{ cellId: "ka", orders: [5], marks: [] }] });
    setLayer("context", {
      sourceId: "c",
      entries: [{ cellId: "ka", orders: [9], marks: ["dakuten"] }],
    });

    const resolved = resolveCell(getState(), "ka");
    expect(resolved.layer).toBe("hover");
    expect(resolved.orders).toEqual([5]);
    expect(resolved.marks).toEqual([]);
    expect(resolved.dimmed).toBe(false);
  });

  it("優先權 pinned > context：同格在 pinned 與 context 時回 pinned", () => {
    setLayer("pinned", { sourceId: "p", entries: [{ cellId: "sa", orders: [1], marks: [] }] });
    setLayer("context", { sourceId: "c", entries: [{ cellId: "sa", orders: [2], marks: [] }] });

    const resolved = resolveCell(getState(), "sa");
    expect(resolved.layer).toBe("pinned");
    expect(resolved.orders).toEqual([1]);
  });

  it("dimmed 在完全沒有任何層時為 false", () => {
    expect(resolveCell(getState(), "a").dimmed).toBe(false);
  });

  it("dimmed 在有層但此格不在任何層中時為 true", () => {
    setLayer("context", buildHighlightSet("word", "あ"));
    const resolved = resolveCell(getState(), "ka");
    expect(resolved.layer).toBeNull();
    expect(resolved.dimmed).toBe(true);
  });

  it("命中的格子回傳正確 layer/orders/marks 且 dimmed 為 false", () => {
    setLayer("context", buildHighlightSet("word", "あ"));
    const resolved = resolveCell(getState(), "a");
    expect(resolved.layer).toBe("context");
    expect(resolved.dimmed).toBe(false);
  });

  it("context 層淡色底、無徽章：即使來源 entry 本身有 orders/marks，resolveCell 也回傳空陣列", () => {
    // がっこう 串接後 か 的 order 遠不是 0（模擬整頁串接時，index 對使用者無意義的情境），
    // 且它本來就帶 dakuten -- 兩者在 context 層都不該被回傳。
    setLayer("context", {
      sourceId: "page",
      entries: [
        { cellId: "ka", orders: [1, 25], marks: ["dakuten"] },
        { cellId: "u", orders: [4, 6, 8], marks: ["chouon"] },
      ],
    });

    const ka = resolveCell(getState(), "ka");
    expect(ka.layer).toBe("context");
    expect(ka.orders).toEqual([]);
    expect(ka.marks).toEqual([]);

    const u = resolveCell(getState(), "u");
    expect(u.layer).toBe("context");
    expect(u.orders).toEqual([]);
    expect(u.marks).toEqual([]);
  });

  it("context 層被 hover 蓋過時，回傳的仍是 hover 自己的 orders/marks（不受 context 剝除規則影響）", () => {
    setLayer("hover", { sourceId: "h", entries: [{ cellId: "ka", orders: [0], marks: ["dakuten"] }] });
    setLayer("context", { sourceId: "c", entries: [{ cellId: "ka", orders: [1, 25], marks: ["dakuten"] }] });

    const resolved = resolveCell(getState(), "ka");
    expect(resolved.layer).toBe("hover");
    expect(resolved.orders).toEqual([0]);
    expect(resolved.marks).toEqual(["dakuten"]);
  });
});
