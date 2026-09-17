import { beforeEach, describe, expect, it } from "vitest";
import { getState, reset, setLayer } from "../highlight";
import { countLitCells, litCellsById } from "../summary";
import type { HighlightSet } from "../highlight";
import type { CellId } from "../../lib/kana";

beforeEach(() => {
  reset();
});

function set(sourceId: string, cellIds: CellId[]): HighlightSet {
  return {
    sourceId,
    entries: cellIds.map((cellId) => ({
      cellId,
      orders: [0],
      marks: [],
    })),
  };
}

describe("countLitCells", () => {
  it("空 state 為 0", () => {
    expect(countLitCells(getState())).toBe(0);
  });

  it("hover 與 pinned 同格不重複計", () => {
    setLayer("hover", set("a", ["ka"]));
    setLayer("pinned", set("b", ["ka"]));
    expect(countLitCells(getState())).toBe(1);
  });

  it("hover 與 pinned 不同格各自計入", () => {
    setLayer("hover", set("a", ["ka"]));
    setLayer("pinned", set("b", ["ki"]));
    expect(countLitCells(getState())).toBe(2);
  });

  it("context 也算", () => {
    setLayer("context", set("c", ["a", "i", "u"]));
    expect(countLitCells(getState())).toBe(3);
  });

  it("三層重疊的格子仍只算一次", () => {
    setLayer("hover", set("a", ["ka"]));
    setLayer("pinned", set("b", ["ka", "ki"]));
    setLayer("context", set("c", ["ka", "ki", "ku"]));
    expect(countLitCells(getState())).toBe(3);
  });
});

describe("litCellsById", () => {
  it("空 state 回空物件", () => {
    expect(litCellsById(getState())).toEqual({});
  });

  it("同格被多層命中時回最高優先權的那層（hover > pinned > context）", () => {
    setLayer("hover", set("a", ["ka"]));
    setLayer("pinned", set("b", ["ka"]));
    setLayer("context", set("c", ["ka"]));
    expect(litCellsById(getState())).toEqual({ ka: "hover" });
  });

  it("pinned 命中、context 也命中但不同格：各自標記正確的層", () => {
    setLayer("pinned", set("b", ["ka"]));
    setLayer("context", set("c", ["ki"]));
    expect(litCellsById(getState())).toEqual({ ka: "pinned", ki: "context" });
  });
});
