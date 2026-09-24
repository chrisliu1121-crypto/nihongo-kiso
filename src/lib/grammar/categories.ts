// Grammar category display metadata, shared by GrammarOverview,
// GrammarItemPage and GrammarPicker (previously duplicated in both pages).

import type { GrammarCategory, GrammarItem } from "../bank";

/** Display order of the six GrammarCategory values. */
export const CATEGORY_ORDER: GrammarCategory[] = ["case", "focus", "conjunctive", "final", "conjunction", "expression"];

export const CATEGORY_LABEL: Record<GrammarCategory, string> = {
  case: "格助詞",
  focus: "係助詞・副助詞",
  conjunctive: "接續助詞",
  final: "終助詞",
  conjunction: "接續詞",
  expression: "副詞・表現",
};

export const CATEGORY_DESCRIPTION: Record<GrammarCategory, string> = {
  case: "標記名詞在句中扮演的角色（誰、對誰、在哪裡、用什麼…）",
  focus: "標記這句話在談什麼、強調什麼、限定什麼範圍",
  conjunctive: "連接兩個子句，說明原因、轉折、假設等關係",
  final: "加在句尾，表示語氣（確認、提醒、感嘆…）",
  conjunction: "連接兩個句子，是句子之間的橋樑，不是助詞",
  expression: "副詞或固定表現，常與特定語氣或句型搭配",
};

/** Route of the verb page, listed in the picker next to the grammar items. */
export const VERBS_ROUTE = "/grammar/verbs";

/**
 * Short hint for an index chip / dropdown option: the first two sense
 * labels, e.g. が -> "主體・焦點（疑問詞的答案）". Kept short on purpose; the
 * item page has the full list.
 */
export function itemHint(item: GrammarItem): string {
  return item.senses
    .slice(0, 2)
    .map((s) => s.label)
    .join("・");
}
