import { describe, expect, it } from "vitest";
import kanaData from "../../../../data/kana.json";
import type { CellId, KanaCell } from "../../kana";
import { SHAPE_GROUPS, SOUND_GROUPS, shapeConfusablesOf, soundConfusablesOf } from "../confusables";

const cells = kanaData.cells as unknown as KanaCell[];
const VALID_IDS = new Set<CellId>(cells.map((c) => c.id));

describe("confusables tables", () => {
  it("every cellId in SHAPE_GROUPS is one of the 46 real cells", () => {
    for (const group of SHAPE_GROUPS) {
      for (const id of group) {
        expect(VALID_IDS.has(id)).toBe(true);
      }
    }
  });

  it("every cellId in SOUND_GROUPS is one of the 46 real cells", () => {
    for (const group of SOUND_GROUPS) {
      for (const id of group) {
        expect(VALID_IDS.has(id)).toBe(true);
      }
    }
  });

  it("no group lists a cell alongside itself", () => {
    for (const group of [...SHAPE_GROUPS, ...SOUND_GROUPS]) {
      expect(new Set(group).size).toBe(group.length);
    }
  });

  it("shapeConfusablesOf/soundConfusablesOf are symmetric within a group", () => {
    for (const group of SHAPE_GROUPS) {
      for (const id of group) {
        for (const other of group) {
          if (other === id) continue;
          expect(shapeConfusablesOf(id)).toContain(other);
        }
      }
    }
    for (const group of SOUND_GROUPS) {
      for (const id of group) {
        for (const other of group) {
          if (other === id) continue;
          expect(soundConfusablesOf(id)).toContain(other);
        }
      }
    }
  });

  it("さ's shape-confusable group includes ち/き (task's own example)", () => {
    expect(shapeConfusablesOf("sa").sort()).toEqual(["chi", "ki"]);
  });

  it("shi/chi/tsu/su are mutually sound-confusable (task's own example)", () => {
    for (const id of ["shi", "chi", "tsu", "su"] as const) {
      const others = ["shi", "chi", "tsu", "su"].filter((x) => x !== id);
      for (const other of others) {
        expect(soundConfusablesOf(id)).toContain(other);
      }
    }
  });

  it("an id with no curated group returns an empty array, not undefined", () => {
    expect(shapeConfusablesOf("wo")).toEqual([]);
  });
});
