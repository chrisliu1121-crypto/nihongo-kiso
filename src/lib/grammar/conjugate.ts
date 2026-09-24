// conjugate — pure verb-conjugation engine (build task 2026-09-24 §C). Zero
// React, zero I/O: takes a verb (surface/reading/class) and a target form,
// returns the conjugated surface/reading. Used by VerbsPage and unit-tested
// against a hand-written expectation table (src/lib/grammar/__tests__/conjugate.test.ts)
// that is NOT derived from this file -- see that test's own header comment.
//
// Terminology used in the comments below: for a godan verb, the "stem" is
// everything except the dictionary form's final kana mora (書く → stem 書/か,
// final か-row consonant/vowel pair determined by that final mora's ROW,
// e.g. く is the k-row's u-dan kana). Conjugation changes that final mora's
// COLUMN (dan) while (for masu/nai) keeping the row, or replaces it with an
// "onbin" (音便, sound-change) cluster for te/ta.

export type VerbClass = "godan" | "ichidan" | "suru" | "kuru";
export type VerbForm =
  | "dictionary"
  | "masu"
  | "nai"
  | "te"
  | "ta"
  /** 可能形 (書ける / 食べられる / できる / 来られる). Always an ichidan verb itself -- see potentialVerb(). */
  | "potential"
  /** 意向形, plain (書こう / 食べよう / しよう / 来よう). */
  | "volitional"
  /** 意向形, polite: the ます-stem + ましょう (書きましょう). */
  | "volitional_polite";


export interface VerbInput {
  surface: string;
  reading: string;
  class: VerbClass;
}

export interface ConjugatedForm {
  surface: string;
  reading: string;
}

// ---------------------------------------------------------------------------
// Godan (五段) tables. Keyed by the dictionary form's FINAL kana (u-dan:
// う・く・ぐ・す・つ・ぬ・ぶ・む・る) -- this is the "row" the rest of this
// file's comments refer to.

/** う-dan final kana -> あ-dan replacement for the ない/ある-style negative stem. う is IRREGULAR here (わ, not あ) -- DESIGN.md-adjacent build task note: 買う→買わない, not 買あない. */
const GODAN_NAI_STEM: Record<string, string> = {
  う: "わ",
  く: "か",
  ぐ: "が",
  す: "さ",
  つ: "た",
  ぬ: "な",
  ぶ: "ば",
  む: "ま",
  る: "ら",
};

/** う-dan final kana -> い-dan replacement for the ます-stem. */
const GODAN_MASU_STEM: Record<string, string> = {
  う: "い",
  く: "き",
  ぐ: "ぎ",
  す: "し",
  つ: "ち",
  ぬ: "に",
  ぶ: "び",
  む: "み",
  る: "り",
};

/** う-dan final kana -> え-dan replacement for the potential form (+る): 書く→書ける, 買う→買える. */
const GODAN_POTENTIAL_STEM: Record<string, string> = {
  う: "え",
  く: "け",
  ぐ: "げ",
  す: "せ",
  つ: "て",
  ぬ: "ね",
  ぶ: "べ",
  む: "め",
  る: "れ",
};

/** う-dan final kana -> お-dan replacement for the volitional form (+う): 書く→書こう, 買う→買おう. */
const GODAN_VOLITIONAL_STEM: Record<string, string> = {
  う: "お",
  く: "こ",
  ぐ: "ご",
  す: "そ",
  つ: "と",
  ぬ: "の",
  ぶ: "ぼ",
  む: "も",
  る: "ろ",
};

/**
 * て/た-form onbin (音便, sound-change) cluster that REPLACES the final
 * u-dan kana entirely (not just its dan, like masu/nai above) -- the
 * cluster already includes the connecting て/で/た/だ.
 *   う・つ・る → って／った
 *   む・ぶ・ぬ → んで／んだ（連濁: で/だ, not て/た）
 *   く       → いて／いた
 *   ぐ       → いで／いだ（連濁）
 *   す       → して／した
 */
const GODAN_ONBIN: Record<string, { te: string; ta: string }> = {
  う: { te: "って", ta: "った" },
  つ: { te: "って", ta: "った" },
  る: { te: "って", ta: "った" },
  む: { te: "んで", ta: "んだ" },
  ぶ: { te: "んで", ta: "んだ" },
  ぬ: { te: "んで", ta: "んだ" },
  く: { te: "いて", ta: "いた" },
  ぐ: { te: "いで", ta: "いだ" },
  す: { te: "して", ta: "した" },
};

/**
 * The one godan verb whose て/た-form breaks the regular く-row onbin rule
 * (which would otherwise produce 行いて/行いた): 行く is いって/いった, matching
 * う・つ・る's cluster instead of く's own. Every other godan-く verb (書く,
 * 聞く, ...) is regular.
 */
const IKU_READING = "いく";

/** ある's ない-form is the single word "ない", not the regular あらない a godan-る verb would otherwise produce. */
const ARU_READING = "ある";

function conjugateGodan(verb: VerbInput, form: VerbForm): ConjugatedForm {
  if (form === "dictionary") return { surface: verb.surface, reading: verb.reading };

  const surfaceStem = verb.surface.slice(0, -1);
  const readingStem = verb.reading.slice(0, -1);
  const lastKana = verb.reading.slice(-1);

  if (form === "nai") {
    if (verb.reading === ARU_READING) return { surface: "ない", reading: "ない" };
    const stem = GODAN_NAI_STEM[lastKana];
    if (!stem) throw new Error(`conjugate: unsupported godan ending "${lastKana}" (nai) in ${verb.reading}`);
    return { surface: `${surfaceStem}${stem}ない`, reading: `${readingStem}${stem}ない` };
  }

  if (form === "masu" || form === "volitional_polite") {
    const stem = GODAN_MASU_STEM[lastKana];
    if (!stem) throw new Error(`conjugate: unsupported godan ending "${lastKana}" (${form}) in ${verb.reading}`);
    const suffix = form === "masu" ? "ます" : "ましょう";
    return { surface: `${surfaceStem}${stem}${suffix}`, reading: `${readingStem}${stem}${suffix}` };
  }

  if (form === "potential" || form === "volitional") {
    const table = form === "potential" ? GODAN_POTENTIAL_STEM : GODAN_VOLITIONAL_STEM;
    const suffix = form === "potential" ? "る" : "う";
    const stem = table[lastKana];
    if (!stem) throw new Error(`conjugate: unsupported godan ending "${lastKana}" (${form}) in ${verb.reading}`);
    return { surface: `${surfaceStem}${stem}${suffix}`, reading: `${readingStem}${stem}${suffix}` };
  }

  // te / ta
  const isIku = verb.reading === IKU_READING;
  const cluster = isIku ? { te: "って", ta: "った" } : GODAN_ONBIN[lastKana];
  if (!cluster) throw new Error(`conjugate: unsupported godan ending "${lastKana}" (${form}) in ${verb.reading}`);
  const suffix = cluster[form];
  return { surface: `${surfaceStem}${suffix}`, reading: `${readingStem}${suffix}` };
}

// ---------------------------------------------------------------------------
// Ichidan (一段): drop the dictionary form's final る, append the form's
// suffix directly to both surface and reading. No onbin, no row-tracking --
// this is why ichidan is the "regular" class next to godan's irregularity.

const ICHIDAN_SUFFIX: Record<Exclude<VerbForm, "dictionary">, string> = {
  masu: "ます",
  nai: "ない",
  te: "て",
  ta: "た",
  potential: "られる",
  volitional: "よう",
  volitional_polite: "ましょう",
};

function conjugateIchidan(verb: VerbInput, form: VerbForm): ConjugatedForm {
  if (form === "dictionary") return { surface: verb.surface, reading: verb.reading };
  const surfaceStem = verb.surface.slice(0, -1);
  const readingStem = verb.reading.slice(0, -1);
  const suffix = ICHIDAN_SUFFIX[form];
  return { surface: `${surfaceStem}${suffix}`, reading: `${readingStem}${suffix}` };
}

// ---------------------------------------------------------------------------
// する / Xする: strip the trailing "する" (both surface and reading always
// end in literal する, even for a kanji-compound verb like 勉強する), then
// append the form's suffix to what's left. Same suffix table as ichidan
// (します/しない/して/した happen to share the pattern), kept as its own
// table for clarity and independence from ichidan's.

const SURU_SUFFIX: Record<Exclude<VerbForm, "dictionary">, string> = {
  masu: "します",
  nai: "しない",
  te: "して",
  ta: "した",
  // する's potential is a different verb, できる (勉強する → 勉強できる).
  potential: "できる",
  volitional: "しよう",
  volitional_polite: "しましょう",
};

function conjugateSuru(verb: VerbInput, form: VerbForm): ConjugatedForm {
  if (form === "dictionary") return { surface: verb.surface, reading: verb.reading };
  const surfacePrefix = verb.surface.slice(0, -2); // strip trailing "する"
  const readingPrefix = verb.reading.slice(0, -2);
  const suffix = SURU_SUFFIX[form];
  return { surface: `${surfacePrefix}${suffix}`, reading: `${readingPrefix}${suffix}` };
}

// ---------------------------------------------------------------------------
// 来る (kuru): the one truly irregular verb. Surface keeps its kanji stem
// "来" and just swaps okurigana (来る/来ます/来ない/来て/来た), exactly like
// ichidan -- but the READING's stem itself changes per form (き/こ/き/き),
// not just its okurigana, which is what makes this irregular rather than a
// disguised ichidan verb (DESIGN.md-adjacent build task note: "surface 漢字
// 不變、reading 改變").

const KURU_READING_STEM: Record<Exclude<VerbForm, "dictionary">, string> = {
  masu: "き",
  nai: "こ",
  te: "き",
  ta: "き",
  potential: "こ",
  volitional: "こ",
  volitional_polite: "き",
};

const KURU_SUFFIX: Record<Exclude<VerbForm, "dictionary">, string> = {
  masu: "ます",
  nai: "ない",
  te: "て",
  ta: "た",
  potential: "られる",
  volitional: "よう",
  volitional_polite: "ましょう",
};

function conjugateKuru(verb: VerbInput, form: VerbForm): ConjugatedForm {
  if (form === "dictionary") return { surface: verb.surface, reading: verb.reading };
  const surfaceStem = verb.surface.slice(0, -1); // "来る" -> "来"
  return {
    surface: `${surfaceStem}${KURU_SUFFIX[form]}`,
    reading: `${KURU_READING_STEM[form]}${KURU_SUFFIX[form]}`,
  };
}

/**
 * The potential form as a verb in its own right. Every potential verb
 * conjugates as ichidan (書ける→書けます／書けない／書けて／書けた; できる and
 * 来られる too), so its ます/ない/て/た forms are just conjugate() on this.
 */
export function potentialVerb(verb: VerbInput): VerbInput {
  const { surface, reading } = conjugate(verb, "potential");
  return { surface, reading, class: "ichidan" };
}

/** Conjugate `verb` into `form`. Pure function -- see this file's header comment for the per-class rules. */
export function conjugate(verb: VerbInput, form: VerbForm): ConjugatedForm {
  switch (verb.class) {
    case "godan":
      return conjugateGodan(verb, form);
    case "ichidan":
      return conjugateIchidan(verb, form);
    case "suru":
      return conjugateSuru(verb, form);
    case "kuru":
      return conjugateKuru(verb, form);
  }
}
