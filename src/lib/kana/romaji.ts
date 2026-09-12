// Modified-Hepburn romanization built on top of kanaToCells.
//
// kanaToCells is the single entry point for conversion, including the
// particle override (§7): it takes the same `{ particle?: boolean }`
// option this module re-exports as ReadingToRomajiOptions. moraeWithRomaji
// is a thin wrapper (kept as its own name for read­ability at call sites,
// e.g. build scripts precomputing data/words/*.json's `morae` field) and
// does not apply any override logic of its own.
//
// What this file actually adds is the ASCII form (romaji_ascii), which
// spells long vowels out literally (とうきょう -> "toukyou") instead of
// merging them into a macron the way the display romaji does.

import type { Mora } from "./types";
import { kanaToCells, SEION_ROMAJI_BY_ID, type KanaToCellsOptions } from "./cells";

export type ReadingToRomajiOptions = KanaToCellsOptions;

export interface RomajiResult {
  romaji: string;
  romaji_ascii: string;
}

const MACRON_TO_PLAIN: Record<string, string> = {
  ā: "a",
  ī: "i",
  ū: "u",
  ē: "e",
  ō: "o",
};

function stripMacrons(s: string): string {
  return s.replace(/[āīūēō]/g, (ch) => MACRON_TO_PLAIN[ch] ?? ch);
}

/**
 * Full per-mora breakdown of `reading`, romaji filled in (including the
 * particle override, when requested). Thin wrapper over kanaToCells --
 * see cells.ts for the actual particle-override contract.
 */
export function moraeWithRomaji(reading: string, opts?: ReadingToRomajiOptions): Mora[] {
  return kanaToCells(reading, opts);
}

/** ASCII spelling of one mora, faithful to its own kana rather than merged into a neighbor. */
function asciiPiece(mora: Mora, prevAsciiPiece: string): string {
  if (mora.marks.includes("chouon")) {
    if (mora.cells.length === 0) {
      // The ー symbol itself: duplicate the vowel it's extending.
      return prevAsciiPiece.slice(-1);
    }
    // Kana functioning as a long vowel (おう/おお/うう/ええ/ああ): spell its
    // own kana literally instead of "" (its merged display value).
    return mora.cells.map((id) => SEION_ROMAJI_BY_ID.get(id) ?? "").join("");
  }
  return stripMacrons(mora.romaji);
}

export function readingToRomaji(reading: string, opts?: ReadingToRomajiOptions): RomajiResult {
  const morae = moraeWithRomaji(reading, opts);

  const romaji = morae.map((m) => m.romaji).join("");

  let romaji_ascii = "";
  for (const m of morae) {
    romaji_ascii += asciiPiece(m, romaji_ascii);
  }

  return { romaji, romaji_ascii };
}
