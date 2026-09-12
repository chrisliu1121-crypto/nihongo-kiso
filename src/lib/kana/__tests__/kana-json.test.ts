import { describe, expect, it } from "vitest";
import kanaData from "../../../../data/kana.json";
import type { CellId, KanaCell } from "../types";

const ALL_CELL_IDS: CellId[] = [
  "a", "i", "u", "e", "o",
  "ka", "ki", "ku", "ke", "ko",
  "sa", "shi", "su", "se", "so",
  "ta", "chi", "tsu", "te", "to",
  "na", "ni", "nu", "ne", "no",
  "ha", "hi", "fu", "he", "ho",
  "ma", "mi", "mu", "me", "mo",
  "ya", "yu", "yo",
  "ra", "ri", "ru", "re", "ro",
  "wa", "wo",
  "n",
];

const cells = kanaData.cells as unknown as KanaCell[];
const byId = new Map(cells.map((c) => [c.id, c]));

describe("data/kana.json", () => {
  it("has exactly 46 cells", () => {
    expect(cells.length).toBe(46);
  });

  it("id set is exactly the CellId union", () => {
    expect(ALL_CELL_IDS.length).toBe(46);
    const jsonIds = [...cells.map((c) => c.id)].sort();
    const unionIds = [...ALL_CELL_IDS].sort();
    expect(jsonIds).toEqual(unionIds);
  });

  it("rows/cols match §8.1", () => {
    expect(kanaData.rows).toEqual(["", "k", "s", "t", "n", "h", "m", "y", "r", "w"]);
    expect(kanaData.cols).toEqual(["a", "i", "u", "e", "o"]);
  });

  it("all 7 い段 cells have a yoon set with exactly ya/yu/yo", () => {
    const iDan = ["ki", "shi", "chi", "ni", "hi", "mi", "ri"] as const;
    expect(iDan.length).toBe(7);
    for (const id of iDan) {
      const cell = byId.get(id);
      expect(cell, `missing cell ${id}`).toBeDefined();
      expect(cell!.yoon, `${id}.yoon should be set`).not.toBeNull();
      const keys = Object.keys(cell!.yoon!).sort();
      expect(keys).toEqual(["ya", "yo", "yu"]);
      expect(Object.keys(cell!.yoon!).length).toBe(3);
    }
  });

  it("cells outside い段 have yoon: null", () => {
    const iDan = new Set(["ki", "shi", "chi", "ni", "hi", "mi", "ri"]);
    for (const cell of cells) {
      if (!iDan.has(cell.id)) {
        expect(cell.yoon, `${cell.id}.yoon should be null`).toBeNull();
      }
    }
  });

  it("は行's 5 cells all have handakuten", () => {
    const hRow = ["ha", "hi", "fu", "he", "ho"] as const;
    expect(hRow.length).toBe(5);
    for (const id of hRow) {
      const cell = byId.get(id);
      expect(cell!.derived.handakuten, `${id}.derived.handakuten should be set`).not.toBeNull();
    }
  });

  it("only は行 has handakuten", () => {
    const hRow = new Set(["ha", "hi", "fu", "he", "ho"]);
    for (const cell of cells) {
      if (!hRow.has(cell.id)) {
        expect(cell.derived.handakuten, `${cell.id}.derived.handakuten should be null`).toBeNull();
      }
    }
  });

  it("か/さ/た/は行 and う all have dakuten", () => {
    const dakutenIds = [
      "ka", "ki", "ku", "ke", "ko",
      "sa", "shi", "su", "se", "so",
      "ta", "chi", "tsu", "te", "to",
      "ha", "hi", "fu", "he", "ho",
      "u",
    ];
    for (const id of dakutenIds) {
      const cell = byId.get(id as CellId);
      expect(cell!.derived.dakuten, `${id}.derived.dakuten should be set`).not.toBeNull();
    }
    // everything else has no dakuten form
    const withDakuten = new Set(dakutenIds);
    for (const cell of cells) {
      if (!withDakuten.has(cell.id)) {
        expect(cell.derived.dakuten, `${cell.id}.derived.dakuten should be null`).toBeNull();
      }
    }
  });

  it("や行 only has ya/yu/yo (i and e columns absent)", () => {
    const yRow = cells.filter((c) => c.row === "y").map((c) => c.id).sort();
    expect(yRow).toEqual(["ya", "yo", "yu"]);
  });

  it("わ行 only has wa/wo (i, u, e columns absent)", () => {
    const wRow = cells.filter((c) => c.row === "w").map((c) => c.id).sort();
    expect(wRow).toEqual(["wa", "wo"]);
  });

  it("stroke_svg / audio / mnemonic are null on every cell", () => {
    for (const cell of cells) {
      expect(cell.stroke_svg).toBeNull();
      expect(cell.audio).toBeNull();
      expect(cell.mnemonic).toBeNull();
    }
  });

  it("を's romaji is always o", () => {
    expect(byId.get("wo")!.romaji).toBe("o");
  });
});
