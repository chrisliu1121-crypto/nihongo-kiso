// 可能形・意向形 tests (2026-09-25). Expectations come from the hand-written
// tables in ./fixtures/verb-pot-vol.ts, not from conjugate() itself.

import { describe, expect, it } from "vitest";
import { conjugate, potentialVerb, type VerbClass } from "../conjugate";
import { kanaToCells } from "../../kana";
import verbsData from "../../../../data/grammar/verbs.json";
import { POT_CHAIN, POT_VOL_READINGS } from "./fixtures/verb-pot-vol";
import { surfaceFromReading } from "./fixtures/surface";

interface VerbFixture {
  surface: string;
  reading: string;
  class: VerbClass;
  gloss: string;
  lacks?: string[];
  lacks_note?: string;
}

const verbs = (verbsData as { verbs: VerbFixture[] }).verbs;

/** 来る changes its reading stem, so the okurigana rule doesn't apply; its surfaces are written out. */
const KURU_SURFACE: Record<string, string> = { こられる: "来られる", こよう: "来よう" };

function expectedSurface(v: VerbFixture, reading: string): string {
  if (v.class === "kuru") return KURU_SURFACE[reading];
  return surfaceFromReading(v.surface, v.reading, reading);
}

describe("可能形・意向形：手寫期望表", () => {
  it("每個動詞都有一筆，且 \"-\" 恰好對應 lacks", () => {
    const surfaces = new Set(verbs.map((v) => v.surface));
    for (const key of Object.keys(POT_VOL_READINGS)) expect(surfaces.has(key), `${key} 不在 verbs.json`).toBe(true);
    for (const v of verbs) {
      const row = POT_VOL_READINGS[v.surface];
      expect(row, `缺少 ${v.surface}`).toBeDefined();
      const [pot, vol] = row.split(" ");
      const lacks = new Set(v.lacks ?? []);
      expect(pot === "-", `${v.surface} 可能形的 "-" 與 lacks 不一致`).toBe(lacks.has("potential"));
      expect(vol === "-", `${v.surface} 意向形的 "-" 與 lacks 不一致`).toBe(lacks.has("volitional"));
      if (lacks.size > 0) expect(v.lacks_note, `${v.surface} 有 lacks 但沒有 lacks_note`).toBeTruthy();
    }
  });
});

describe("conjugate: 可能形・意向形", () => {
  for (const v of verbs) {
    const [pot, vol] = POT_VOL_READINGS[v.surface]?.split(" ") ?? ["-", "-"];
    if (pot !== "-") {
      it(`${v.surface} 可能形 = ${pot}`, () => {
        expect(conjugate(v, "potential")).toEqual({ surface: expectedSurface(v, pot), reading: pot });
        expect(() => kanaToCells(pot)).not.toThrow();
      });
    }
    if (vol !== "-") {
      it(`${v.surface} 意向形 = ${vol}`, () => {
        expect(conjugate(v, "volitional")).toEqual({ surface: expectedSurface(v, vol), reading: vol });
        expect(() => kanaToCells(vol)).not.toThrow();
      });
    }
  }
});

describe("可能動詞的活用（一段）與 ましょう", () => {
  const byId = new Map(verbs.map((v) => [v.surface, v]));
  for (const [surface, chain] of Object.entries(POT_CHAIN)) {
    it(surface, () => {
      const v = byId.get(surface)!;
      const pv = potentialVerb(v);
      expect(pv.class).toBe("ichidan");
      expect(conjugate(pv, "masu").surface).toBe(chain.masu);
      expect(conjugate(pv, "nai").surface).toBe(chain.nai);
      expect(conjugate(pv, "te").surface).toBe(chain.te);
      expect(conjugate(pv, "ta").surface).toBe(chain.ta);
      expect(conjugate(v, "volitional_polite").surface).toBe(chain.mashou);
    });
  }

  it("ましょう形一律等於 ます形把 ます 換成 ましょう", () => {
    for (const v of verbs) {
      const masu = conjugate(v, "masu");
      const polite = conjugate(v, "volitional_polite");
      expect(polite.surface, v.surface).toBe(masu.surface.replace(/ます$/, "ましょう"));
      expect(polite.reading, v.surface).toBe(masu.reading.replace(/ます$/, "ましょう"));
    }
  });
});
