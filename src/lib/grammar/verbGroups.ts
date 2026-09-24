// Grouping of data/grammar/verbs.json for /grammar/verbs: godan verbs by
// their dictionary-form ending (う・く・ぐ・す・つ・ぬ・ぶ・む・る), ichidan by
// the row of the kana before る (い段 / え段). Everything is derived from the
// reading, so adding a verb to verbs.json needs no change here.

import { readingToRomaji } from "../kana";
import type { VerbClass } from "./conjugate";

export interface VerbEntry {
  surface: string;
  reading: string;
  class: VerbClass;
  gloss: string;
  /**
   * Gloss used to build the derived forms' glosses when the automatic
   * shortening would lose the meaning (貸す 借出 vs 借りる 借入).
   */
  short_gloss?: string;
  /** Per-form gloss overrides for the basic forms (違う: ない形「沒有不同」, not「不不同」). */
  gloss_forms?: Partial<Record<"masu" | "nai" | "te" | "ta", string>>;
  /**
   * Display romaji of the dictionary form, only where the rule-based
   * conversion is wrong: a verb-final う after an お/う sound is a morpheme
   * boundary, not a long vowel (思う omou, not omō; DESIGN.md §7 已知限制).
   */
  romaji?: string;
  /** Forms this verb doesn't have (non-volitional verbs such as ある、分かる、見える). */
  lacks?: ("potential" | "volitional")[];
  /** Why, shown in place of the missing forms. */
  lacks_note?: string;
}

export interface VerbGroup {
  key: string;
  label: string;
  /** How the group conjugates, e.g. "〜います・〜わない・〜って". */
  rule: string;
  /** Marks the "looks ichidan but is godan" group. */
  warn?: boolean;
  verbs: VerbEntry[];
}

const GODAN_ENDINGS = ["う", "く", "ぐ", "す", "つ", "ぬ", "ぶ", "む", "る"] as const;

const GODAN_RULE: Record<(typeof GODAN_ENDINGS)[number], string> = {
  う: "〜います・〜わない・〜って",
  く: "〜きます・〜かない・〜いて（行く → 行って）",
  ぐ: "〜ぎます・〜がない・〜いで",
  す: "〜します・〜さない・〜して",
  つ: "〜ちます・〜たない・〜って",
  ぬ: "〜にます・〜なない・〜んで",
  ぶ: "〜びます・〜ばない・〜んで",
  む: "〜みます・〜まない・〜んで",
  る: "〜ります・〜らない・〜って（ある → ない）",
};

/** "iru" / "eru" / null: the vowel row of the kana before a final る, read off the romaji. */
function ruRow(reading: string): "i" | "e" | null {
  if (!reading.endsWith("る")) return null;
  const romaji = readingToRomaji(reading).romaji;
  if (romaji.endsWith("iru")) return "i";
  if (romaji.endsWith("eru")) return "e";
  return null;
}

/** A godan verb that ends in い段／え段＋る, so it looks ichidan (帰る、入る、走る…). */
export function looksIchidan(verb: VerbEntry): boolean {
  return verb.class === "godan" && ruRow(verb.reading) !== null;
}

export function verbGroups(verbs: readonly VerbEntry[], cls: VerbClass): VerbGroup[] {
  const inClass = verbs.filter((v) => v.class === cls);
  const nonEmpty = (groups: VerbGroup[]) => groups.filter((g) => g.verbs.length > 0);

  if (cls === "godan") {
    const groups: VerbGroup[] = GODAN_ENDINGS.map((end) => ({
      key: end,
      label: `〜${end}`,
      rule: GODAN_RULE[end],
      verbs: inClass.filter((v) => v.reading.endsWith(end) && !looksIchidan(v)),
    }));
    groups.push({
      key: "ru-lookalike",
      label: "〜る（看似一段）",
      rule: "長得像一段動詞，其實是五段：〜ります・〜らない・〜って",
      warn: true,
      verbs: inClass.filter(looksIchidan),
    });
    return nonEmpty(groups);
  }
  if (cls === "ichidan") {
    return nonEmpty([
      { key: "i", label: "い段＋る", rule: "去掉る：〜ます・〜ない・〜て・〜た", verbs: inClass.filter((v) => ruRow(v.reading) === "i") },
      { key: "e", label: "え段＋る", rule: "去掉る：〜ます・〜ない・〜て・〜た", verbs: inClass.filter((v) => ruRow(v.reading) === "e") },
    ]);
  }
  if (cls === "suru") {
    return nonEmpty([{ key: "suru", label: "する・名詞＋する", rule: "〜します・〜しない・〜して・〜した", verbs: inClass }]);
  }
  return nonEmpty([{ key: "kuru", label: "来る", rule: "きます・こない・きて・きた（讀音會變）", verbs: inClass }]);
}
