export type {
  CellId,
  CellMark,
  Mora,
  KanaCell,
  KanaDerivedForm,
  KanaYoonSet,
  KanaTable,
  KanaInputErrorReason,
} from "./types.ts";
export { KanaInputError } from "./types.ts";

export type { KanaToCellsOptions } from "./cells.ts";
export { kanaToCells, toHiragana } from "./cells.ts";

export type { ReadingToRomajiOptions, RomajiResult } from "./romaji.ts";
export { readingToRomaji, moraeWithRomaji } from "./romaji.ts";
