// kanaToCells — the load-bearing conversion from a kana reading to per-mora
// gojuon-table cells. Every word, sentence token, and particle in the site
// routes through this function to light up the kana table, so its output
// must be deterministic and never silently wrong: unknown non-kana input
// throws KanaInputError rather than being dropped or guessed at, and a
// small kana that can't attach to anything (string-initial, or right after
// a yoon/sokuon/chouon/ん/out-of-table mora) throws too -- real Japanese
// never produces that sequence, so silently accepting it would just be a
// backdoor for bad data.
//
// Known limitation: cross-morpheme long-vowel sequences (e.g. 思う "omou",
// where お ends one morpheme and う starts the next) are indistinguishable
// from genuine long vowels (とうきょう) using reading text alone, so they
// get merged into a macron the same way. See romaji.ts for the test that
// pins this down explicitly.
//
// Particle override (は/へ read as wa/e only when used as a particle, §7):
// this is the ONLY entry point that applies it, via the `particle` option
// below. There is deliberately no second code path with different
// behavior -- callers that need the override pass `{ particle: true }`
// here; nothing else in this module (or romaji.ts, which is a thin wrapper
// over this function) knows about particle-ness independently. A particle
// token must be its own reading (e.g. reading "は" alone, not a whole
// sentence) -- call this once per token, never once for a whole sentence.

import kanaData from "../../../data/kana.json" with { type: "json" };
import type { CellId, CellMark, KanaCell, Mora } from "./types.ts";
import { KanaInputError } from "./types.ts";

const KANA_CELLS = kanaData.cells as unknown as KanaCell[];

/** hiragana char -> its plain CellId (covers all 46 base characters, incl. ん) */
const CHAR_TO_ID = new Map<string, CellId>();
/** CellId -> its own plain romaji, e.g. "ka" -> "ka", "n" -> "n" */
const ID_TO_ROMAJI = new Map<CellId, string>();
/** dakuten hiragana char (が, じ, ゔ, ...) -> base seion CellId */
const DAKUTEN_CHAR_TO_BASE = new Map<string, CellId>();
const DAKUTEN_ROMAJI = new Map<string, string>();
/** handakuten hiragana char (ぱ, ぴ, ...) -> base seion CellId */
const HANDAKUTEN_CHAR_TO_BASE = new Map<string, CellId>();
const HANDAKUTEN_ROMAJI = new Map<string, string>();
/** base seion CellId -> its seion yoon set (きゃ/きゅ/きょ etc.), straight from kana.json */
const YOON_TABLE = new Map<CellId, KanaCell["yoon"]>();

for (const cell of KANA_CELLS) {
  const id = cell.id;
  CHAR_TO_ID.set(cell.hiragana, id);
  ID_TO_ROMAJI.set(id, cell.romaji);

  if (cell.derived.dakuten) {
    DAKUTEN_CHAR_TO_BASE.set(cell.derived.dakuten.hiragana, id);
    DAKUTEN_ROMAJI.set(cell.derived.dakuten.hiragana, cell.derived.dakuten.romaji);
  }
  if (cell.derived.handakuten) {
    HANDAKUTEN_CHAR_TO_BASE.set(cell.derived.handakuten.hiragana, id);
    HANDAKUTEN_ROMAJI.set(cell.derived.handakuten.hiragana, cell.derived.handakuten.romaji);
  }
  if (cell.yoon) {
    YOON_TABLE.set(id, cell.yoon);
  }
}

/**
 * Seion-only base romaji, keyed by CellId (e.g. "ka" -> "ka", "n" -> "n").
 * Exported ONLY for romaji.ts's romaji_ascii spelling of kana-as-chouon
 * morae (う in とう must spell literally as "u"). Not a general "look up any
 * cell's romaji" table -- it has nothing to say about dakuten/handakuten/
 * yoon combinations -- so it is not re-exported from index.ts.
 */
export const SEION_ROMAJI_BY_ID: ReadonlyMap<CellId, string> = ID_TO_ROMAJI;

// Yoon roots that aren't in kana.json because kana.json only stores the
// seion yoon set. Dakuten/handakuten yoon romaji = root + vowel letter.
const DAKUTEN_YOON_ROOT: Partial<Record<CellId, string>> = {
  ki: "gy", // ぎゃ
  shi: "j", // じゃ
  chi: "j", // ぢゃ (same reading as じゃ in modified Hepburn)
  hi: "by", // びゃ
};
const HANDAKUTEN_YOON_ROOT: Partial<Record<CellId, string>> = {
  hi: "py", // ぴゃ
};

const SMALL_Y_TO_CELL: Record<string, CellId> = { ゃ: "ya", ゅ: "yu", ょ: "yo" };
const SMALL_VOWEL_TO_CELL: Record<string, CellId> = {
  ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o",
};
const SMALL_VOWEL_LETTER: Record<string, string> = {
  ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o",
};
/** Every small kana that's structurally kana but needs something to attach to (KanaInputErrorReason "orphan-small" when it has nothing). ゎ has no attachment branch at all (yet) so it always falls through here. */
const ORPHAN_SMALL_CHARS = new Set([
  ...Object.keys(SMALL_Y_TO_CELL),
  ...Object.keys(SMALL_VOWEL_TO_CELL),
  "ゎ",
]);

const MACRON: Record<string, string> = { a: "ā", i: "ī", u: "ū", e: "ē", o: "ō" };

// Which regular (non-small) vowel character, following a mora whose romaji
// ends in the given vowel letter, triggers a long-vowel merge. い is
// deliberately absent from every list: えい stays "ei", いい stays "ii".
const LONG_VOWEL_TRIGGERS: Record<string, string[]> = {
  o: ["う", "お"],
  u: ["う"],
  e: ["え"],
  a: ["あ"],
};

const OUT_OF_TABLE_ROMAJI: Record<string, string> = {
  ゐ: "wi",
  ゑ: "we",
  ゕ: "ka",
  ゖ: "ke",
  ゝ: "",
  ゞ: "",
  ヽ: "",
  ヾ: "",
};
const OUT_OF_TABLE_CHARS = new Set(Object.keys(OUT_OF_TABLE_ROMAJI));

const PLAIN_VOWEL_CHARS = new Set(["あ", "い", "う", "え", "お"]);

/** Katakana U+30A1-U+30F6 -> hiragana; everything else (incl. ー, ヽ, ヾ) passthrough. */
function normalizeChar(ch: string): string {
  const code = ch.codePointAt(0)!;
  if (code >= 0x30a1 && code <= 0x30f6) {
    return String.fromCodePoint(code - 0x60);
  }
  return ch;
}

/** Convert a whole string from katakana to hiragana (ー and out-of-table forms untouched). */
export function toHiragana(s: string): string {
  return Array.from(s).map(normalizeChar).join("");
}

function yoonSuffixLetter(which: "ya" | "yu" | "yo"): string {
  return which === "ya" ? "a" : which === "yu" ? "u" : "o";
}

function smallVowelExtRomaji(prevRomaji: string, vowelLetter: string): string {
  if (prevRomaji.length <= 1) {
    // Bare vowel row (u/a/i/e/o as the whole previous mora) -> w-glide,
    // matching う + small vowel = wi/we/wa/wo.
    return "w" + vowelLetter;
  }
  return prevRomaji.slice(0, -1) + vowelLetter;
}

function sokuonRomaji(next: Mora | undefined): string {
  // Word-final っ, or っ immediately before a vowel: there's no following
  // consonant to double, so surface it as a glottal-stop apostrophe rather
  // than silently dropping it to "" (which would be indistinguishable from
  // the mora simply not existing, e.g. あっ vs あ).
  if (!next || !next.romaji) return "'";
  const firstChar = next.romaji[0];
  if ("aiueo".includes(firstChar)) return "'";
  if (next.cells[0] === "chi") return "t"; // Hepburn writes tch, not cch
  return firstChar;
}

function nRomaji(next: Mora | undefined): string {
  if (!next || !next.romaji) return "n";
  const firstChar = next.romaji[0];
  if ("aiueoy".includes(firstChar)) return "n'";
  return "n";
}

export interface KanaToCellsOptions {
  /** は/へ read as "wa"/"e" instead of "ha"/"he" (§7 override table). Pass
   *  this only when `reading` IS the particle token itself. */
  particle?: boolean;
}

/** は/へ read "wa"/"e" only when used as a particle; を is always "o" already. */
function applyParticleOverride(morae: Mora[]): void {
  for (const m of morae) {
    if (m.cells.length !== 1 || m.marks.length !== 0) continue;
    if (m.cells[0] === "ha") m.romaji = "wa";
    else if (m.cells[0] === "he") m.romaji = "e";
  }
}

export function kanaToCells(reading: string, opts?: KanaToCellsOptions): Mora[] {
  const chars = Array.from(reading);
  const norm = chars.map(normalizeChar);
  const morae: Mora[] = [];

  let i = 0;
  while (i < chars.length) {
    const oc = chars[i];
    const nc = norm[i];

    // --- sokuon ---
    if (nc === "っ") {
      morae.push({ index: morae.length, text: oc, cells: ["tsu"], marks: ["sokuon"], romaji: "" });
      i += 1;
      continue;
    }

    // --- chouon symbol ---
    if (nc === "ー") {
      const prev = morae[morae.length - 1];
      if (prev && prev.romaji) {
        const lastLetter = prev.romaji.slice(-1);
        const macron = MACRON[lastLetter];
        if (macron) prev.romaji = prev.romaji.slice(0, -1) + macron;
      }
      morae.push({ index: morae.length, text: oc, cells: [], marks: ["chouon"], romaji: "" });
      i += 1;
      continue;
    }

    // --- ん ---
    if (nc === "ん") {
      morae.push({ index: morae.length, text: oc, cells: ["n"], marks: [], romaji: "" });
      i += 1;
      continue;
    }

    // --- plain vowel row (あいうえお), incl. long-vowel merge detection ---
    if (PLAIN_VOWEL_CHARS.has(nc)) {
      const selfId = CHAR_TO_ID.get(nc)!;
      const prev = morae[morae.length - 1];
      let merged = false;
      if (prev && prev.romaji) {
        const lastLetter = prev.romaji.slice(-1);
        const triggers = LONG_VOWEL_TRIGGERS[lastLetter];
        if (triggers && triggers.includes(nc)) {
          prev.romaji = prev.romaji.slice(0, -1) + MACRON[lastLetter];
          merged = true;
        }
      }
      if (merged) {
        morae.push({ index: morae.length, text: oc, cells: [selfId], marks: ["chouon"], romaji: "" });
        i += 1;
        continue;
      }

      // Not a long-vowel merge -- still check forward for a small-vowel
      // extension (う + small ぃ -> wi, as in うぃんど). Regular あいうえお
      // never collide with the small ぁぃぅぇぉ codepoints, so this can't
      // double-fire with the backward check above.
      const nextSmallVowel = norm[i + 1];
      if (nextSmallVowel && nextSmallVowel in SMALL_VOWEL_TO_CELL) {
        const vCell = SMALL_VOWEL_TO_CELL[nextSmallVowel];
        const romaji = smallVowelExtRomaji(ID_TO_ROMAJI.get(selfId)!, SMALL_VOWEL_LETTER[nextSmallVowel]);
        morae.push({
          index: morae.length,
          text: oc + chars[i + 1],
          cells: [selfId, vCell],
          marks: ["small"],
          romaji,
        });
        i += 2;
        continue;
      }

      morae.push({ index: morae.length, text: oc, cells: [selfId], marks: [], romaji: ID_TO_ROMAJI.get(selfId)! });
      i += 1;
      continue;
    }

    // Note: no "orphan small ya/yu/yo" or "orphan small vowel extension"
    // branch here (deliberately). A small ゃゅょぁぃぅぇぉゎ that isn't
    // consumed by the lookahead in the dakuten/handakuten/seion/plain-vowel
    // branches below -- string-initial, or right after a yoon/sokuon/
    // chouon/ん/out-of-table mora -- falls through to the throw at the
    // bottom of this loop. Real Japanese never produces that sequence.

    // --- dakuten ---
    if (DAKUTEN_CHAR_TO_BASE.has(nc)) {
      const baseId = DAKUTEN_CHAR_TO_BASE.get(nc)!;
      const baseRomaji = DAKUTEN_ROMAJI.get(nc)!;
      const nextNc = norm[i + 1];

      if (nextNc && nextNc in SMALL_Y_TO_CELL && DAKUTEN_YOON_ROOT[baseId]) {
        const yCell = SMALL_Y_TO_CELL[nextNc];
        const root = DAKUTEN_YOON_ROOT[baseId]!;
        const romaji = root + yoonSuffixLetter(yCell as "ya" | "yu" | "yo");
        morae.push({
          index: morae.length,
          text: oc + chars[i + 1],
          cells: [baseId, yCell],
          marks: ["dakuten", "small"],
          romaji,
        });
        i += 2;
        continue;
      }

      if (nextNc && nextNc in SMALL_VOWEL_TO_CELL) {
        const vCell = SMALL_VOWEL_TO_CELL[nextNc];
        const romaji = smallVowelExtRomaji(baseRomaji, SMALL_VOWEL_LETTER[nextNc]);
        morae.push({
          index: morae.length,
          text: oc + chars[i + 1],
          cells: [baseId, vCell],
          marks: ["dakuten", "small"],
          romaji,
        });
        i += 2;
        continue;
      }

      morae.push({ index: morae.length, text: oc, cells: [baseId], marks: ["dakuten"], romaji: baseRomaji });
      i += 1;
      continue;
    }

    // --- handakuten ---
    if (HANDAKUTEN_CHAR_TO_BASE.has(nc)) {
      const baseId = HANDAKUTEN_CHAR_TO_BASE.get(nc)!;
      const baseRomaji = HANDAKUTEN_ROMAJI.get(nc)!;
      const nextNc = norm[i + 1];

      if (nextNc && nextNc in SMALL_Y_TO_CELL && HANDAKUTEN_YOON_ROOT[baseId]) {
        const yCell = SMALL_Y_TO_CELL[nextNc];
        const root = HANDAKUTEN_YOON_ROOT[baseId]!;
        const romaji = root + yoonSuffixLetter(yCell as "ya" | "yu" | "yo");
        morae.push({
          index: morae.length,
          text: oc + chars[i + 1],
          cells: [baseId, yCell],
          marks: ["handakuten", "small"],
          romaji,
        });
        i += 2;
        continue;
      }

      if (nextNc && nextNc in SMALL_VOWEL_TO_CELL) {
        const vCell = SMALL_VOWEL_TO_CELL[nextNc];
        const romaji = smallVowelExtRomaji(baseRomaji, SMALL_VOWEL_LETTER[nextNc]);
        morae.push({
          index: morae.length,
          text: oc + chars[i + 1],
          cells: [baseId, vCell],
          marks: ["handakuten", "small"],
          romaji,
        });
        i += 2;
        continue;
      }

      morae.push({ index: morae.length, text: oc, cells: [baseId], marks: ["handakuten"], romaji: baseRomaji });
      i += 1;
      continue;
    }

    // --- out-of-table kana ---
    if (OUT_OF_TABLE_CHARS.has(nc)) {
      morae.push({
        index: morae.length,
        text: oc,
        cells: [],
        marks: ["out_of_table"],
        romaji: OUT_OF_TABLE_ROMAJI[nc],
      });
      i += 1;
      continue;
    }

    // --- remaining seion (consonant-initial) kana ---
    if (CHAR_TO_ID.has(nc)) {
      const baseId = CHAR_TO_ID.get(nc)!;
      const nextNc = norm[i + 1];

      if (nextNc && nextNc in SMALL_Y_TO_CELL && YOON_TABLE.has(baseId)) {
        const yCell = SMALL_Y_TO_CELL[nextNc];
        const yoon = YOON_TABLE.get(baseId)!;
        const which = yCell === "ya" ? "ya" : yCell === "yu" ? "yu" : "yo";
        morae.push({
          index: morae.length,
          text: oc + chars[i + 1],
          cells: [baseId, yCell],
          marks: ["small"],
          romaji: yoon![which].romaji,
        });
        i += 2;
        continue;
      }

      if (nextNc && nextNc in SMALL_VOWEL_TO_CELL) {
        const vCell = SMALL_VOWEL_TO_CELL[nextNc];
        const romaji = smallVowelExtRomaji(ID_TO_ROMAJI.get(baseId)!, SMALL_VOWEL_LETTER[nextNc]);
        morae.push({
          index: morae.length,
          text: oc + chars[i + 1],
          cells: [baseId, vCell],
          marks: ["small"],
          romaji,
        });
        i += 2;
        continue;
      }

      morae.push({ index: morae.length, text: oc, cells: [baseId], marks: [], romaji: ID_TO_ROMAJI.get(baseId)! });
      i += 1;
      continue;
    }

    // --- not kana at all, or a small kana with nothing to attach to ---
    throw new KanaInputError(oc, i, ORPHAN_SMALL_CHARS.has(nc) ? "orphan-small" : "non-kana");
  }

  // Second pass (reverse, so "next" is always already resolved): fill in
  // sokuon and ん romaji, which both depend on the following mora.
  for (let k = morae.length - 1; k >= 0; k--) {
    const m = morae[k];
    if (m.marks.includes("sokuon")) {
      m.romaji = sokuonRomaji(morae[k + 1]);
    } else if (m.cells.length === 1 && m.cells[0] === "n" && m.marks.length === 0) {
      m.romaji = nRomaji(morae[k + 1]);
    }
  }

  if (opts?.particle) applyParticleOverride(morae);

  return morae;
}

/** Mark type re-export purely so consumers don't need a second import line. */
export type { CellMark };
