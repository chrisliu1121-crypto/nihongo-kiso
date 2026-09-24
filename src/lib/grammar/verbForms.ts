// The rows of the conjugation panel on /grammar/verbs: 基本形, 可能形 and its
// own ます/ない/て/た (a potential verb conjugates as ichidan), and 意向形 with
// its common follow-ups. Pure data so it can be tested without React.

import { conjugate, potentialVerb } from "./conjugate";
import { readingToRomaji } from "../kana";
import type { VerbEntry } from "./verbGroups";

export interface FormCell {
  label: string;
  surface: string;
  reading: string;
  gloss: string;
  /** Display romaji override (dictionary form only, see VerbEntry.romaji). */
  romaji?: string;
}

export interface FormRow {
  key: "basic" | "potential" | "volitional" | "none";
  title: string;
  /** Anchor of the rule section explaining this row, if any. */
  anchor?: string;
  cells: FormCell[];
  /** Set instead of cells when the verb has no such form. */
  missing?: string;
}

/**
 * First meaning of a gloss without any （…）qualifier, for the derived
 * forms: 「使…停下／停（車）（他動）」→「使…停下」,「穿（衣服、外套）」→「穿」.
 * The dictionary form keeps the full gloss.
 */
export function shortGloss(full: string): string {
  const s = full.replace(/（[^）]*）/g, "").split("／")[0].trim();
  return s || full;
}

/**
 * Romaji of a volitional reading (書こう, 思おう, 見よう, しよう). Its last
 * two kana are an お段 kana + う = a long ō, but converting the whole reading
 * also merges that お段 kana with the kana before it when both are o-sounds
 * (おもおう -> "omōu" instead of "omoō"). So: stem, then the お段 kana with
 * its o lengthened.
 */
export function volitionalRomaji(reading: string): string {
  const stem = readingToRomaji(reading.slice(0, -2)).romaji;
  const oKana = readingToRomaji(reading.slice(-2, -1)).romaji;
  return `${stem}${oKana.replace(/o$/, "ō")}`;
}

export function formRows(verb: VerbEntry): FormRow[] {
  const g = verb.short_gloss ?? shortGloss(verb.gloss);
  const over = verb.gloss_forms ?? {};
  const cell = (label: string, form: { surface: string; reading: string }, gloss: string): FormCell => ({
    label,
    surface: form.surface,
    reading: form.reading,
    gloss,
  });
  const lacks = new Set(verb.lacks ?? []);
  const note = verb.lacks_note ?? "這個動詞沒有這個形。";

  const basic: FormRow = {
    key: "basic",
    title: "基本形",
    cells: [
      { ...cell("辭書形", conjugate(verb, "dictionary"), verb.gloss), romaji: verb.romaji },
      cell("ます形", conjugate(verb, "masu"), over.masu ?? `${g}（禮貌）`),
      cell("ない形", conjugate(verb, "nai"), over.nai ?? `不${g}`),
      cell("て形", conjugate(verb, "te"), over.te ?? `${g}（て形）`),
      cell("た形", conjugate(verb, "ta"), over.ta ?? `${g}了`),
    ],
  };

  let potential: FormRow;
  if (lacks.has("potential")) {
    potential = { key: "potential", title: "可能形", anchor: "potential", cells: [], missing: note };
  } else {
    const pv = potentialVerb(verb);
    potential = {
      key: "potential",
      title: "可能形",
      anchor: "potential",
      cells: [
        cell("可能形", pv, `能${g}`),
        cell("＋ます", conjugate(pv, "masu"), `能${g}（禮貌）`),
        cell("＋ない", conjugate(pv, "nai"), `不能${g}`),
        cell("＋て", conjugate(pv, "te"), `能${g}（て形）`),
        cell("＋た", conjugate(pv, "ta"), `（當時）能${g}`),
      ],
    };
  }

  let volitional: FormRow;
  if (lacks.has("volitional")) {
    volitional = { key: "volitional", title: "意向形", anchor: "volitional", cells: [], missing: note };
  } else {
    const vol = conjugate(verb, "volitional");
    volitional = {
      key: "volitional",
      title: "意向形",
      anchor: "volitional",
      cells: [
        { ...cell("意向形", vol, `${g}吧`), romaji: volitionalRomaji(vol.reading) },
        cell("ましょう", conjugate(verb, "volitional_polite"), `${g}吧（禮貌）`),
      ],
    };
  }

  // Neither form: one row with the note once, not the same note twice.
  if (lacks.has("potential") && lacks.has("volitional")) {
    return [basic, { key: "none", title: "可能形・意向形", cells: [], missing: note }];
  }
  return [basic, potential, volitional];
}
