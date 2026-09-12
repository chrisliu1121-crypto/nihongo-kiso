// Core types for the kana conversion layer.
//
// This is the load-bearing layer for the whole site: every word, sentence,
// and particle token gets routed through kanaToCells to light up the
// gojuon table. Keep this file free of UI concerns.

export type CellId =
  | "a" | "i" | "u" | "e" | "o"
  | "ka" | "ki" | "ku" | "ke" | "ko"
  | "sa" | "shi" | "su" | "se" | "so"
  | "ta" | "chi" | "tsu" | "te" | "to"
  | "na" | "ni" | "nu" | "ne" | "no"
  | "ha" | "hi" | "fu" | "he" | "ho"
  | "ma" | "mi" | "mu" | "me" | "mo"
  | "ya" | "yu" | "yo"
  | "ra" | "ri" | "ru" | "re" | "ro"
  | "wa" | "wo"
  | "n"; // 共 46

export type CellMark =
  | "dakuten"
  | "handakuten"
  | "small"
  | "sokuon"
  | "chouon"
  | "out_of_table";

export interface Mora {
  index: number; // 第幾拍，從 0
  text: string; // 這一拍的表記，如 "きゃ"
  cells: CellId[]; // 0～2 格
  marks: CellMark[];
  romaji: string;
}

export interface KanaDerivedForm {
  hiragana: string;
  katakana: string;
  romaji: string;
}

export interface KanaYoonSet {
  ya: { hiragana: string; romaji: string };
  yu: { hiragana: string; romaji: string };
  yo: { hiragana: string; romaji: string };
}

/** Shape of one entry in data/kana.json's `cells` array. */
export interface KanaCell {
  id: CellId;
  hiragana: string;
  katakana: string;
  row: string;
  col: string;
  romaji: string;
  derived: {
    dakuten: KanaDerivedForm | null;
    handakuten: KanaDerivedForm | null;
  };
  yoon: KanaYoonSet | null;
  stroke_svg: string | null;
  audio: string | null;
  mnemonic: string | null;
}

export interface KanaTable {
  version: number;
  rows: string[];
  cols: string[];
  cells: KanaCell[];
}

/**
 * Thrown by kanaToCells (and anything built on it) when the input reading
 * contains a character that is not kana (kanji, latin letters, punctuation,
 * whitespace, digits, ...). We throw rather than silently drop/skip because
 * a silent failure here would corrupt highlighting everywhere downstream.
 */
export class KanaInputError extends Error {
  char: string;
  index: number;

  constructor(char: string, index: number) {
    super(`KanaInputError: non-kana character ${JSON.stringify(char)} at index ${index}`);
    this.name = "KanaInputError";
    this.char = char;
    this.index = index;
  }
}
