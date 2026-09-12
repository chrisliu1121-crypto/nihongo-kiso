import { describe, expect, it } from "vitest";
import { moraeWithRomaji, readingToRomaji } from "../romaji";

describe("readingToRomaji", () => {
  it("irregular seion readings: shi/chi/tsu/fu/ji/zu", () => {
    expect(readingToRomaji("し").romaji).toBe("shi");
    expect(readingToRomaji("ち").romaji).toBe("chi");
    expect(readingToRomaji("つ").romaji).toBe("tsu");
    expect(readingToRomaji("ふ").romaji).toBe("fu");
    expect(readingToRomaji("じ").romaji).toBe("ji");
    expect(readingToRomaji("ず").romaji).toBe("zu");
  });

  it("yoon: sha/shu/sho, cha, ja, kya (romaji + romaji_ascii)", () => {
    expect(readingToRomaji("しゃ")).toEqual({ romaji: "sha", romaji_ascii: "sha" });
    expect(readingToRomaji("しゅ")).toEqual({ romaji: "shu", romaji_ascii: "shu" });
    expect(readingToRomaji("しょ")).toEqual({ romaji: "sho", romaji_ascii: "sho" });
    expect(readingToRomaji("ちゃ")).toEqual({ romaji: "cha", romaji_ascii: "cha" });
    expect(readingToRomaji("じゃ")).toEqual({ romaji: "ja", romaji_ascii: "ja" });
    expect(readingToRomaji("きゃ")).toEqual({ romaji: "kya", romaji_ascii: "kya" });
  });

  it("yoon full Mora[]: きゃ (cells/marks are what actually drives table highlighting)", () => {
    expect(moraeWithRomaji("きゃ")).toEqual([
      { index: 0, text: "きゃ", cells: ["ki", "ya"], marks: ["small"], romaji: "kya" },
    ]);
  });

  it("促音: まっちゃ (matcha), きって (kitte)", () => {
    expect(readingToRomaji("まっちゃ").romaji).toBe("matcha");
    expect(readingToRomaji("きって").romaji).toBe("kitte");
  });

  it("促音: 詞尾／後接母音時 romaji 與 romaji_ascii 皆為 glottal-stop apostrophe", () => {
    expect(readingToRomaji("あっ")).toEqual({ romaji: "a'", romaji_ascii: "a'" });
  });

  it("撥音 ん + 隔音符: しんゆう / きんえん", () => {
    expect(readingToRomaji("しんゆう").romaji).toBe("shin'yū");
    expect(readingToRomaji("きんえん").romaji).toBe("kin'en");
  });

  it("長音: とうきょう / ちゅうごく / おねえさん / らーめん", () => {
    expect(readingToRomaji("とうきょう").romaji).toBe("tōkyō");
    expect(readingToRomaji("ちゅうごく").romaji).toBe("chūgoku");
    expect(readingToRomaji("おねえさん").romaji).toBe("onēsan");
    expect(readingToRomaji("ラーメン").romaji).toBe("rāmen");
  });

  it("長音 full Mora[]: ちゅうごく (yoon + long-vowel merge together)", () => {
    expect(moraeWithRomaji("ちゅうごく")).toEqual([
      { index: 0, text: "ちゅ", cells: ["chi", "yu"], marks: ["small"], romaji: "chū" },
      { index: 1, text: "う", cells: ["u"], marks: ["chouon"], romaji: "" },
      { index: 2, text: "ご", cells: ["ko"], marks: ["dakuten"], romaji: "go" },
      { index: 3, text: "く", cells: ["ku"], marks: [], romaji: "ku" },
    ]);
    expect(readingToRomaji("ちゅうごく")).toEqual({ romaji: "chūgoku", romaji_ascii: "chuugoku" });
  });

  it("えい 保留 ei，いい 保留 ii", () => {
    expect(readingToRomaji("せんせい").romaji).toBe("sensei");
    expect(readingToRomaji("いいます").romaji).toBe("iimasu");
  });

  it("romaji_ascii：忠於假名拼寫，去 macron", () => {
    expect(readingToRomaji("とうきょう").romaji_ascii).toBe("toukyou");
    expect(readingToRomaji("ラーメン").romaji_ascii).toBe("raamen");
    expect(readingToRomaji("しんゆう").romaji_ascii).toBe("shin'yuu");
  });

  it("助詞 override: は", () => {
    expect(readingToRomaji("は", { particle: true }).romaji).toBe("wa");
    expect(readingToRomaji("は").romaji).toBe("ha");
    expect(readingToRomaji("は", { particle: false }).romaji).toBe("ha");
  });

  it("助詞 override: へ", () => {
    expect(readingToRomaji("へ", { particle: true }).romaji).toBe("e");
    expect(readingToRomaji("へ").romaji).toBe("he");
    expect(readingToRomaji("へ", { particle: false }).romaji).toBe("he");
  });

  it("助詞 override: を 永遠是 o", () => {
    expect(readingToRomaji("を", { particle: true }).romaji).toBe("o");
    expect(readingToRomaji("を").romaji).toBe("o");
    expect(readingToRomaji("を", { particle: false }).romaji).toBe("o");
  });

  it("known limitation: 思う (omou) is misread as long-vowel omō", () => {
    // お (from 思-) and う (the verb ending) straddle a morpheme boundary,
    // not a real long vowel, but kanaToCells can't tell that from the
    // reading string alone -- it only sees お immediately followed by う and
    // applies the same merge as とうきょう. This is a known, accepted
    // limitation; word-level data is expected to supply a romaji_override
    // upstream (see DESIGN.md §7) rather than trust this function for verbs
    // like this one.
    expect(readingToRomaji("おもう").romaji).toBe("omō");
  });

  describe("moraeWithRomaji", () => {
    it("golden case: がっこう", () => {
      expect(moraeWithRomaji("がっこう")).toEqual([
        { index: 0, text: "が", cells: ["ka"], marks: ["dakuten"], romaji: "ga" },
        { index: 1, text: "っ", cells: ["tsu"], marks: ["sokuon"], romaji: "k" },
        { index: 2, text: "こ", cells: ["ko"], marks: [], romaji: "kō" },
        { index: 3, text: "う", cells: ["u"], marks: ["chouon"], romaji: "" },
      ]);
      expect(readingToRomaji("がっこう")).toEqual({ romaji: "gakkō", romaji_ascii: "gakkou" });
    });

    it("is a thin wrapper over kanaToCells: applies the particle override directly", () => {
      const morae = moraeWithRomaji("は", { particle: true });
      expect(morae).toEqual([{ index: 0, text: "は", cells: ["ha"], marks: [], romaji: "wa" }]);
    });
  });

  it("外來音小書き romaji + romaji_ascii: ふぁ/てぃ/うぃ/ゔぁ/しぇ/ちぇ/じぇ/つぁ", () => {
    expect(readingToRomaji("ふぁ")).toEqual({ romaji: "fa", romaji_ascii: "fa" });
    expect(readingToRomaji("てぃ")).toEqual({ romaji: "ti", romaji_ascii: "ti" });
    expect(readingToRomaji("うぃ")).toEqual({ romaji: "wi", romaji_ascii: "wi" });
    expect(readingToRomaji("ゔぁ")).toEqual({ romaji: "va", romaji_ascii: "va" });
    expect(readingToRomaji("しぇ")).toEqual({ romaji: "she", romaji_ascii: "she" });
    expect(readingToRomaji("ちぇ")).toEqual({ romaji: "che", romaji_ascii: "che" });
    expect(readingToRomaji("じぇ")).toEqual({ romaji: "je", romaji_ascii: "je" });
    expect(readingToRomaji("つぁ")).toEqual({ romaji: "tsa", romaji_ascii: "tsa" });
  });

  it("外來音小書き full Mora[]: ふぁ (cells must show the 2-cell fu+a highlight, not just the romaji)", () => {
    expect(moraeWithRomaji("ふぁ")).toEqual([
      { index: 0, text: "ふぁ", cells: ["fu", "a"], marks: ["small"], romaji: "fa" },
    ]);
  });
});
