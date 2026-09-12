import { describe, expect, it } from "vitest";
import { kanaToCells, toHiragana } from "../cells";
import { KanaInputError } from "../types";
import kanaData from "../../../../data/kana.json";
import type { CellId, KanaCell } from "../types";

describe("kanaToCells", () => {
  it("清音: あさ", () => {
    expect(kanaToCells("あさ")).toEqual([
      { index: 0, text: "あ", cells: ["a"], marks: [], romaji: "a" },
      { index: 1, text: "さ", cells: ["sa"], marks: [], romaji: "sa" },
    ]);
  });

  it("濁音: ぢ・づ・ゔ", () => {
    expect(kanaToCells("ぢ")).toEqual([
      { index: 0, text: "ぢ", cells: ["chi"], marks: ["dakuten"], romaji: "ji" },
    ]);
    expect(kanaToCells("づ")).toEqual([
      { index: 0, text: "づ", cells: ["tsu"], marks: ["dakuten"], romaji: "zu" },
    ]);
    expect(kanaToCells("ゔ")).toEqual([
      { index: 0, text: "ゔ", cells: ["u"], marks: ["dakuten"], romaji: "vu" },
    ]);
  });

  it("濁音: が (also covers the plain dakuten case)", () => {
    expect(kanaToCells("が")).toEqual([
      { index: 0, text: "が", cells: ["ka"], marks: ["dakuten"], romaji: "ga" },
    ]);
  });

  it("半濁音: ぱ", () => {
    expect(kanaToCells("ぱ")).toEqual([
      { index: 0, text: "ぱ", cells: ["ha"], marks: ["handakuten"], romaji: "pa" },
    ]);
  });

  it("清音拗音: きゃ", () => {
    expect(kanaToCells("きゃ")).toEqual([
      { index: 0, text: "きゃ", cells: ["ki", "ya"], marks: ["small"], romaji: "kya" },
    ]);
  });

  it("濁音拗音: じゃ", () => {
    expect(kanaToCells("じゃ")).toEqual([
      { index: 0, text: "じゃ", cells: ["shi", "ya"], marks: ["dakuten", "small"], romaji: "ja" },
    ]);
  });

  it("促音: がっこう", () => {
    expect(kanaToCells("がっこう")).toEqual([
      { index: 0, text: "が", cells: ["ka"], marks: ["dakuten"], romaji: "ga" },
      { index: 1, text: "っ", cells: ["tsu"], marks: ["sokuon"], romaji: "k" },
      { index: 2, text: "こ", cells: ["ko"], marks: [], romaji: "kō" },
      { index: 3, text: "う", cells: ["u"], marks: ["chouon"], romaji: "" },
    ]);
  });

  it("促音：詞尾／後接母音時 romaji 為 glottal-stop apostrophe, 不吃掉資訊", () => {
    // あっ must stay distinguishable from plain あ.
    expect(kanaToCells("あっ")).toEqual([
      { index: 0, text: "あ", cells: ["a"], marks: [], romaji: "a" },
      { index: 1, text: "っ", cells: ["tsu"], marks: ["sokuon"], romaji: "'" },
    ]);
    // っ immediately before a vowel mora (no consonant to double either).
    expect(kanaToCells("まっあ")).toEqual([
      { index: 0, text: "ま", cells: ["ma"], marks: [], romaji: "ma" },
      { index: 1, text: "っ", cells: ["tsu"], marks: ["sokuon"], romaji: "'" },
      { index: 2, text: "あ", cells: ["a"], marks: [], romaji: "a" },
    ]);
  });

  it("particle override 直接在 kanaToCells 套用（單一入口）", () => {
    expect(kanaToCells("は", { particle: true })[0].romaji).toBe("wa");
    expect(kanaToCells("は")[0].romaji).toBe("ha");
    expect(kanaToCells("へ", { particle: true })[0].romaji).toBe("e");
    expect(kanaToCells("へ")[0].romaji).toBe("he");
    expect(kanaToCells("を", { particle: true })[0].romaji).toBe("o");
    expect(kanaToCells("を")[0].romaji).toBe("o");
  });

  it("長音符: ラーメン (katakana chouon symbol)", () => {
    expect(kanaToCells("ラーメン")).toEqual([
      { index: 0, text: "ラ", cells: ["ra"], marks: [], romaji: "rā" },
      { index: 1, text: "ー", cells: [], marks: ["chouon"], romaji: "" },
      { index: 2, text: "メ", cells: ["me"], marks: [], romaji: "me" },
      { index: 3, text: "ン", cells: ["n"], marks: [], romaji: "n" },
    ]);
  });

  it("假名長音: とうきょう", () => {
    expect(kanaToCells("とうきょう")).toEqual([
      { index: 0, text: "と", cells: ["to"], marks: [], romaji: "tō" },
      { index: 1, text: "う", cells: ["u"], marks: ["chouon"], romaji: "" },
      { index: 2, text: "きょ", cells: ["ki", "yo"], marks: ["small"], romaji: "kyō" },
      { index: 3, text: "う", cells: ["u"], marks: ["chouon"], romaji: "" },
    ]);
  });

  it("えい 不標長音: せんせい", () => {
    const morae = kanaToCells("せんせい");
    expect(morae).toEqual([
      { index: 0, text: "せ", cells: ["se"], marks: [], romaji: "se" },
      { index: 1, text: "ん", cells: ["n"], marks: [], romaji: "n" },
      { index: 2, text: "せ", cells: ["se"], marks: [], romaji: "se" },
      { index: 3, text: "い", cells: ["i"], marks: [], romaji: "i" },
    ]);
    for (const m of morae) expect(m.marks).not.toContain("chouon");
  });

  it("外來音小書き: ふぁ、てぃ", () => {
    expect(kanaToCells("ふぁ")).toEqual([
      { index: 0, text: "ふぁ", cells: ["fu", "a"], marks: ["small"], romaji: "fa" },
    ]);
    expect(kanaToCells("てぃ")).toEqual([
      { index: 0, text: "てぃ", cells: ["te", "i"], marks: ["small"], romaji: "ti" },
    ]);
  });

  it("ん: 一般情況與詞尾", () => {
    expect(kanaToCells("ほん")).toEqual([
      { index: 0, text: "ほ", cells: ["ho"], marks: [], romaji: "ho" },
      { index: 1, text: "ん", cells: ["n"], marks: [], romaji: "n" },
    ]);
  });

  it("片假名整詞轉換: コンピューター", () => {
    expect(kanaToCells("コンピューター")).toEqual([
      { index: 0, text: "コ", cells: ["ko"], marks: [], romaji: "ko" },
      { index: 1, text: "ン", cells: ["n"], marks: [], romaji: "n" },
      { index: 2, text: "ピュ", cells: ["hi", "yu"], marks: ["handakuten", "small"], romaji: "pyū" },
      { index: 3, text: "ー", cells: [], marks: ["chouon"], romaji: "" },
      { index: 4, text: "タ", cells: ["ta"], marks: [], romaji: "tā" },
      { index: 5, text: "ー", cells: [], marks: ["chouon"], romaji: "" },
    ]);
  });

  it("表外: ゐ", () => {
    expect(kanaToCells("ゐ")).toEqual([
      { index: 0, text: "ゐ", cells: [], marks: ["out_of_table"], romaji: "wi" },
    ]);
  });

  it("表外: ヵ・ヶ・ゝ・ゞ・ヽ・ヾ don't throw", () => {
    for (const ch of ["ヵ", "ヶ", "ゝ", "ゞ", "ヽ", "ヾ", "ゑ"]) {
      expect(() => kanaToCells(ch)).not.toThrow();
      const [mora] = kanaToCells(ch);
      expect(mora.cells).toEqual([]);
      expect(mora.marks).toEqual(["out_of_table"]);
    }
  });

  it("重複假名: ここ — two independent morae with identical cells", () => {
    const morae = kanaToCells("ここ");
    expect(morae).toEqual([
      { index: 0, text: "こ", cells: ["ko"], marks: [], romaji: "ko" },
      { index: 1, text: "こ", cells: ["ko"], marks: [], romaji: "ko" },
    ]);
    expect(morae[0].cells).toEqual(morae[1].cells);
  });

  it("孤兒小字（字首）throw：ゃ・ぁ・ゎ 開頭時沒有東西可依附", () => {
    for (const ch of ["ゃ", "ゅ", "ょ", "ぁ", "ぃ", "ぅ", "ぇ", "ぉ", "ゎ"]) {
      expect(() => kanaToCells(ch)).toThrow(KanaInputError);
      try {
        kanaToCells(ch);
      } catch (e) {
        expect((e as KanaInputError).char).toBe(ch);
        expect((e as KanaInputError).index).toBe(0);
        expect((e as KanaInputError).reason).toBe("orphan-small");
      }
    }
  });

  it("孤兒小字（前一拍不可依附）throw：拗音／促音／長音／ん／表外之後", () => {
    const cases: Array<[string, string, number]> = [
      ["きょぁ", "ぁ", 2], // 前一拍已是拗音 きょ（一拍兩格，占 index 0-1），ぁ 在 index 2 無法再依附
      ["っぁ", "ぁ", 1], // 前一拍是促音
      ["ーぁ", "ぁ", 1], // 前一拍是長音符
      ["んぁ", "ぁ", 1], // 前一拍是撥音
      ["ゐぁ", "ぁ", 1], // 前一拍是表外假名
    ];
    for (const [input, char, index] of cases) {
      expect(() => kanaToCells(input), `${input} should throw`).toThrow(KanaInputError);
      try {
        kanaToCells(input);
      } catch (e) {
        expect((e as KanaInputError).char, input).toBe(char);
        expect((e as KanaInputError).index, input).toBe(index);
        expect((e as KanaInputError).reason, input).toBe("orphan-small");
      }
    }
  });

  it("非假名字元 throw：学校 在 index 0", () => {
    try {
      kanaToCells("学校");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(KanaInputError);
      expect((e as KanaInputError).char).toBe("学");
      expect((e as KanaInputError).index).toBe(0);
      expect((e as KanaInputError).reason).toBe("non-kana");
    }
  });

  it("非假名字元 throw：かa 在 index 1", () => {
    try {
      kanaToCells("かa");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(KanaInputError);
      expect((e as KanaInputError).char).toBe("a");
      expect((e as KanaInputError).index).toBe(1);
      expect((e as KanaInputError).reason).toBe("non-kana");
    }
  });

  it("toHiragana converts katakana, leaves ー untouched", () => {
    expect(toHiragana("コンピューター")).toBe("こんぴゅーたー");
    expect(toHiragana("ラーメン")).toBe("らーめん");
  });

  describe("46-cell reference table (independent of kana.json and cells.ts's own maps)", () => {
    // This table is hand-typed here, on purpose: it does NOT import
    // kana.json's data or route through cells.ts's CHAR_TO_ID/ID_TO_ROMAJI
    // maps (which are themselves *built from* kana.json). Comparing
    // kanaToCells's output against kana.json would be circular -- a typo in
    // kana.json's own "romaji" field would silently agree with itself. This
    // table is the independent check: it catches a typo in kana.json (part
    // 1 below) AND a mismatch between kana.json and what kanaToCells
    // actually produces (part 2 below), which a round-trip through the
    // same source could never catch.
    const REFERENCE: Array<{ id: CellId; hiragana: string; katakana: string; romaji: string }> = [
      { id: "a", hiragana: "あ", katakana: "ア", romaji: "a" },
      { id: "i", hiragana: "い", katakana: "イ", romaji: "i" },
      { id: "u", hiragana: "う", katakana: "ウ", romaji: "u" },
      { id: "e", hiragana: "え", katakana: "エ", romaji: "e" },
      { id: "o", hiragana: "お", katakana: "オ", romaji: "o" },
      { id: "ka", hiragana: "か", katakana: "カ", romaji: "ka" },
      { id: "ki", hiragana: "き", katakana: "キ", romaji: "ki" },
      { id: "ku", hiragana: "く", katakana: "ク", romaji: "ku" },
      { id: "ke", hiragana: "け", katakana: "ケ", romaji: "ke" },
      { id: "ko", hiragana: "こ", katakana: "コ", romaji: "ko" },
      { id: "sa", hiragana: "さ", katakana: "サ", romaji: "sa" },
      { id: "shi", hiragana: "し", katakana: "シ", romaji: "shi" },
      { id: "su", hiragana: "す", katakana: "ス", romaji: "su" },
      { id: "se", hiragana: "せ", katakana: "セ", romaji: "se" },
      { id: "so", hiragana: "そ", katakana: "ソ", romaji: "so" },
      { id: "ta", hiragana: "た", katakana: "タ", romaji: "ta" },
      { id: "chi", hiragana: "ち", katakana: "チ", romaji: "chi" },
      { id: "tsu", hiragana: "つ", katakana: "ツ", romaji: "tsu" },
      { id: "te", hiragana: "て", katakana: "テ", romaji: "te" },
      { id: "to", hiragana: "と", katakana: "ト", romaji: "to" },
      { id: "na", hiragana: "な", katakana: "ナ", romaji: "na" },
      { id: "ni", hiragana: "に", katakana: "ニ", romaji: "ni" },
      { id: "nu", hiragana: "ぬ", katakana: "ヌ", romaji: "nu" },
      { id: "ne", hiragana: "ね", katakana: "ネ", romaji: "ne" },
      { id: "no", hiragana: "の", katakana: "ノ", romaji: "no" },
      { id: "ha", hiragana: "は", katakana: "ハ", romaji: "ha" },
      { id: "hi", hiragana: "ひ", katakana: "ヒ", romaji: "hi" },
      { id: "fu", hiragana: "ふ", katakana: "フ", romaji: "fu" },
      { id: "he", hiragana: "へ", katakana: "ヘ", romaji: "he" },
      { id: "ho", hiragana: "ほ", katakana: "ホ", romaji: "ho" },
      { id: "ma", hiragana: "ま", katakana: "マ", romaji: "ma" },
      { id: "mi", hiragana: "み", katakana: "ミ", romaji: "mi" },
      { id: "mu", hiragana: "む", katakana: "ム", romaji: "mu" },
      { id: "me", hiragana: "め", katakana: "メ", romaji: "me" },
      { id: "mo", hiragana: "も", katakana: "モ", romaji: "mo" },
      { id: "ya", hiragana: "や", katakana: "ヤ", romaji: "ya" },
      { id: "yu", hiragana: "ゆ", katakana: "ユ", romaji: "yu" },
      { id: "yo", hiragana: "よ", katakana: "ヨ", romaji: "yo" },
      { id: "ra", hiragana: "ら", katakana: "ラ", romaji: "ra" },
      { id: "ri", hiragana: "り", katakana: "リ", romaji: "ri" },
      { id: "ru", hiragana: "る", katakana: "ル", romaji: "ru" },
      { id: "re", hiragana: "れ", katakana: "レ", romaji: "re" },
      { id: "ro", hiragana: "ろ", katakana: "ロ", romaji: "ro" },
      { id: "wa", hiragana: "わ", katakana: "ワ", romaji: "wa" },
      { id: "wo", hiragana: "を", katakana: "ヲ", romaji: "o" },
      { id: "n", hiragana: "ん", katakana: "ン", romaji: "n" },
    ];

    it("has exactly 46 entries, one per CellId", () => {
      expect(REFERENCE.length).toBe(46);
      expect(new Set(REFERENCE.map((r) => r.id)).size).toBe(46);
    });

    const cells = kanaData.cells as unknown as KanaCell[];
    const byId = new Map(cells.map((c) => [c.id, c]));

    it.each(REFERENCE)("kana.json's $id cell matches the reference table", ({ id, hiragana, katakana, romaji }) => {
      const cell = byId.get(id);
      expect(cell, `kana.json is missing cell ${id}`).toBeDefined();
      expect(cell!.hiragana).toBe(hiragana);
      expect(cell!.katakana).toBe(katakana);
      expect(cell!.romaji).toBe(romaji);
    });

    it.each(REFERENCE)("kanaToCells($hiragana) matches the reference table", ({ id, hiragana, romaji }) => {
      const [mora] = kanaToCells(hiragana);
      expect(mora.cells).toEqual([id]);
      expect(mora.romaji).toBe(romaji);
    });
  });
});
