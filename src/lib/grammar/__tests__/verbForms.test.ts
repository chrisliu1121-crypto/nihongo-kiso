import { describe, expect, it } from "vitest";
import verbsData from "../../../../data/grammar/verbs.json";
import { formRows, shortGloss, volitionalRomaji } from "../verbForms";
import type { VerbEntry } from "../verbGroups";
import { kanaToCells, readingToRomaji } from "../../kana";

const verbs = (verbsData as { verbs: VerbEntry[] }).verbs;
const byId = new Map(verbs.map((v) => [v.surface, v]));

describe("formRows", () => {
  it("書く: 基本形・可能形・意向形 in order", () => {
    const rows = formRows(byId.get("書く")!);
    expect(rows.map((r) => r.cells.map((c) => c.surface))).toEqual([
      ["書く", "書きます", "書かない", "書いて", "書いた"],
      ["書ける", "書けます", "書けない", "書けて", "書けた"],
      ["書こう", "書きましょう"],
    ]);
    expect(rows[1].cells[2].gloss).toBe("不能寫");
    expect(rows[2].cells[1].gloss).toBe("寫吧（禮貌）");
  });

  it("勉強する uses できる; 来る reads こられる / こよう", () => {
    expect(formRows(byId.get("勉強する")!)[1].cells[0].surface).toBe("勉強できる");
    const kuru = formRows(byId.get("来る")!);
    expect(kuru[1].cells[0].reading).toBe("こられる");
    expect(kuru[2].cells[0].reading).toBe("こよう");
    expect(kuru[2].cells[1].reading).toBe("きましょう");
  });

  it("a verb with lacks shows its note instead of cells", () => {
    const aru = formRows(byId.get("ある")!);
    expect(aru).toHaveLength(2);
    expect(aru[1].key).toBe("none");
    expect(aru[1].cells).toEqual([]);
    expect(aru[1].missing).toContain("物品存在");
    const shiru = formRows(byId.get("知る")!);
    expect(shiru[1].missing).toBeTruthy();
    expect(shiru[2].cells[0].surface).toBe("知ろう");
  });

  it("every produced reading is valid kana for every verb", () => {
    for (const v of verbs) {
      for (const row of formRows(v)) {
        for (const c of row.cells) expect(() => kanaToCells(c.reading), `${v.surface} ${c.label}`).not.toThrow();
      }
    }
  });

  it("verbs whose final う would be misread as a long vowel carry a romaji override", () => {
    for (const v of verbs) {
      const auto = readingToRomaji(v.reading).romaji;
      const misread = v.class === "godan" && v.reading.endsWith("う") && /[ōū]$/.test(auto);
      if (misread) expect(v.romaji, `${v.surface}（${auto}）需要 romaji override`).toBeDefined();
      if (v.romaji) expect(v.romaji.replace(/[^a-z]/g, "")).toBe(v.romaji);
    }
    expect(byId.get("思う")!.romaji).toBe("omou");
  });

  it("volitional romaji lengthens the final o without merging across the stem", () => {
    const expected: Record<string, string> = {
      かこう: "kakō",
      おもおう: "omoō",
      ひろおう: "hiroō",
      すおう: "suō",
      あおう: "aō",
      みよう: "miyō",
      たべよう: "tabeyō",
      しよう: "shiyō",
      べんきょうしよう: "benkyōshiyō",
      こよう: "koyō",
      がんばろう: "ganbarō",
      いこう: "ikō",
    };
    for (const [reading, romaji] of Object.entries(expected)) expect(volitionalRomaji(reading), reading).toBe(romaji);
    expect(formRows(byId.get("思う")!)[2].cells[0].romaji).toBe("omoō");
  });

  it("shortGloss drops qualifiers and keeps the first meaning", () => {
    expect(shortGloss("使…停下／停（車）（他動）")).toBe("使…停下");
    expect(shortGloss("穿（衣服、外套）")).toBe("穿");
    expect(shortGloss("（物品）在／有")).toBe("在");
    expect(shortGloss("寫")).toBe("寫");
  });
});
