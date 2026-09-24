// VerbsPage — "/grammar/verbs": verb classification (五段・一段・不規則) +
// conjugation table. Reads data/grammar/verbs.json directly (not part of
// data/bank.json: no per-word derived fields for build-bank.ts to compute).
//
// Layout (2026-09-25 redesign):
//   header + jump menu -> three class cards -> 活用表 (class tabs, the
//   selected verb's five forms, then every verb of that class grouped by
//   ending) -> reference: how to tell 一段 from 五段, て／た音便 table.
// Every verb chip is a Token: hover shows the Chinese gloss bubble and
// highlights its kana on the gojuon table; click selects it for the table.

import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Token } from "../components/Token";
import { GrammarJumpSelect } from "../components/GrammarPicker";
import { conjugate } from "../lib/grammar/conjugate";
import type { VerbClass, VerbForm } from "../lib/grammar/conjugate";
import { looksIchidan, verbGroups, type VerbEntry } from "../lib/grammar/verbGroups";
import { useMediaQuery } from "../lib/ui/useMediaQuery";
import verbsData from "../../data/grammar/verbs.json";

const verbs = (verbsData as { verbs: VerbEntry[] }).verbs;

const CLASS_ORDER: VerbClass[] = ["godan", "ichidan", "suru", "kuru"];

const CLASS_LABEL: Record<VerbClass, string> = {
  godan: "五段動詞",
  ichidan: "一段動詞",
  suru: "する（不規則）",
  kuru: "来る（不規則）",
};

const CLASS_DESCRIPTION: Record<VerbClass, string> = {
  godan:
    "辭書形詞尾是う段假名（く・ぐ・す・つ・ぬ・ぶ・む・る・う之一）。ない形、ます形時，詞尾在五十音「同一行」之間變化（書か（ない）／書き（ます）／書く）；て形、た形則走另一套「音便」規則（書い（て）），見下方表格，不是同行變化。",
  ichidan:
    "辭書形詞尾固定是る，且る前一拍是い段或え段音（例：食べる、見る）。活用最簡單：把る去掉，直接加語尾（食べ＋ます／ない／て／た）。",
  suru: "する 本身或「N＋する」（勉強する、散歩する）。活用固定：します／しない／して／した，N 的部分不變。",
  kuru: "唯一一個活用方式獨立於以上三類的動詞。漢字「来」不變，但讀音隨形態改變：来る(くる)／来ます(きます)／来ない(こない)／来て(きて)／来た(きた)。",
};

const FORM_ORDER: VerbForm[] = ["dictionary", "masu", "nai", "te", "ta"];

const FORM_LABEL: Record<VerbForm, string> = {
  dictionary: "辭書形",
  masu: "ます形",
  nai: "ない形",
  te: "て形",
  ta: "た形",
};

/**
 * Per-form Chinese gloss shown under each conjugated Token. The dictionary
 * form keeps the full gloss; the other forms use only its first meaning
 * without the （自動）/（他動）tag, so 止める reads 「使…停下（禮貌）」 rather
 * than 「使…停下／停（車）（他動）（禮貌）」.
 */
function formGloss(fullGloss: string, form: VerbForm): string {
  if (form === "dictionary") return fullGloss;
  const baseGloss = fullGloss.replace(/（[自他]動）/g, "").split("／")[0];
  switch (form) {
    case "masu":
      return `${baseGloss}（禮貌）`;
    case "nai":
      return `不${baseGloss}`;
    case "te":
      return `${baseGloss}（て形）`;
    case "ta":
      return `${baseGloss}了`;
  }
}

const ONBIN_ROWS: { endings: string; te: string; ta: string; note?: string }[] = [
  { endings: "う・つ・る", te: "って", ta: "った" },
  { endings: "む・ぶ・ぬ", te: "んで", ta: "んだ", note: "ん 之後變濁音：で／だ，不是て／た" },
  { endings: "く", te: "いて", ta: "いた", note: "例外：行く → 行って／行った（不是行いて／行いた）" },
  { endings: "ぐ", te: "いで", ta: "いだ", note: "ぐ 的濁音保留：で／だ" },
  { endings: "す", te: "して", ta: "した" },
];

const LOOKALIKES = verbs.filter(looksIchidan);

/** The desktop panel sticks just under the sticky header (--nav-h, see Layout.tsx). */
const DESKTOP_QUERY = "(min-width: 1024px)";

export function VerbsPage() {
  const countByClass = useMemo(() => {
    const counts = new Map<VerbClass, number>();
    for (const v of verbs) counts.set(v.class, (counts.get(v.class) ?? 0) + 1);
    return counts;
  }, []);

  const [selectedClass, setSelectedClass] = useState<VerbClass>("godan");
  const groups = useMemo(() => verbGroups(verbs, selectedClass), [selectedClass]);
  const [selectedSurface, setSelectedSurface] = useState<string>(groups[0]?.verbs[0]?.surface ?? "");

  const classVerbs = groups.flatMap((g) => g.verbs);
  const selectedVerb = classVerbs.find((v) => v.surface === selectedSurface) ?? classVerbs[0];

  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const panelRef = useRef<HTMLDivElement>(null);

  function selectClass(cls: VerbClass): void {
    setSelectedClass(cls);
    const first = verbGroups(verbs, cls)[0]?.verbs[0];
    if (first) setSelectedSurface(first.surface);
  }

  function selectVerb(surface: string): void {
    setSelectedSurface(surface);
    // Below lg the panel isn't sticky, so bring it back into view.
    if (!isDesktop) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Link to="/grammar" className="text-sm text-stone-500 hover:text-amber-700 hover:underline">
            ← 文法總覽
          </Link>
          <GrammarJumpSelect currentId="verbs" />
        </div>
        <h1 className="text-2xl font-bold text-stone-900">動詞：五段・一段・不規則</h1>
        <p className="text-sm text-stone-600">
          日語動詞依活用方式分三大類。辭書形（字典裡查到的原形）的詞尾看得出線索，但一段動詞有一批例外，要單獨記住。
        </p>
      </section>

      {/* 三類說明 */}
      <section className="grid gap-3 sm:grid-cols-2">
        {CLASS_ORDER.map((cls) => (
          <div key={cls} className="rounded-lg border border-stone-200 bg-white p-4">
            <p className="text-sm font-semibold text-stone-800">{CLASS_LABEL[cls]}</p>
            <p className="mt-1 text-xs leading-relaxed text-stone-500">{CLASS_DESCRIPTION[cls]}</p>
          </div>
        ))}
      </section>

      {/* 活用表：選類別 -> 看活用 -> 依詞尾分組的動詞 */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-stone-800">活用表</h2>
          <p className="mt-1 text-xs text-stone-500">
            滑鼠移到動詞上會顯示中文，五十音表同步高亮；點一下就在上方看它的五種形。
          </p>
        </div>

        <div role="tablist" aria-label="動詞類別" className="flex flex-wrap gap-2">
          {CLASS_ORDER.map((cls) => (
            <button
              key={cls}
              type="button"
              role="tab"
              aria-selected={selectedClass === cls}
              onClick={() => selectClass(cls)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
                selectedClass === cls
                  ? "border-amber-400 bg-amber-50 text-amber-800"
                  : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
              }`}
            >
              {CLASS_LABEL[cls]}
              <span className="ml-1.5 text-xs font-normal text-stone-400">{countByClass.get(cls) ?? 0}</span>
            </button>
          ))}
        </div>

        {selectedVerb && (
          <div
            ref={panelRef}
            className="scroll-mt-[calc(var(--nav-h)+0.5rem)] rounded-xl border border-amber-200 bg-amber-50/70 p-4 shadow-sm backdrop-blur lg:sticky lg:top-[calc(var(--nav-h)+0.5rem)] lg:z-[25]"
          >
            <p className="text-xs text-stone-500">
              <span className="font-semibold text-stone-800">{selectedVerb.surface}</span>
              <span className="mx-1.5">·</span>
              {selectedVerb.gloss}
              {looksIchidan(selectedVerb) && (
                <span className="ml-2 rounded bg-amber-200/70 px-1.5 py-0.5 text-[11px] text-amber-900">看似一段，其實五段</span>
              )}
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
              {FORM_ORDER.map((form) => {
                const { surface, reading } = conjugate(selectedVerb, form);
                return (
                  <div key={form} className="flex flex-col items-center gap-1">
                    <span className="text-[11px] font-medium text-stone-500">{FORM_LABEL[form]}</span>
                    <Token
                      surface={surface}
                      reading={reading}
                      gloss={formGloss(selectedVerb.gloss, form)}
                      role="verb"
                      size="sm"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-3">
          {groups.map((group) => (
            <div
              key={group.key}
              className={`rounded-lg border p-3 ${
                group.warn ? "border-amber-200 bg-amber-50/40" : "border-stone-200 bg-white"
              }`}
            >
              <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="text-sm font-semibold text-stone-800">{group.label}</span>
                <span className="text-xs text-stone-500">{group.rule}</span>
                <span className="text-xs text-stone-400">{group.verbs.length} 個</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {group.verbs.map((v) => (
                  <Token
                    key={v.surface}
                    surface={v.surface}
                    reading={v.reading}
                    gloss={v.gloss}
                    glossMode="hover"
                    role="verb"
                    size="sm"
                    pinnable={false}
                    selected={selectedVerb?.surface === v.surface}
                    onActivate={() => selectVerb(v.surface)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 怎麼判別 */}
      <section className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
        <h2 className="text-sm font-semibold text-stone-800">怎麼判別一段還是五段？</h2>
        <p className="mt-2 text-sm text-stone-700">
          辭書形詞尾是<strong>る</strong>，且る前一拍是<strong>い段</strong>
          （い・き・し・ち・に・ひ・み・り…）或<strong>え段</strong>
          （え・け・せ・て・ね・へ・め・れ…）音 → 大多是一段動詞（食べる、見る、起きる…）。
        </p>
        <p className="mt-2 text-sm text-stone-700">
          <strong>但有例外</strong>：下面這幾個長得像一段動詞，其實是五段動詞，只能背下來——
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {LOOKALIKES.map((verb) => (
            <Token
              key={verb.surface}
              surface={verb.surface}
              reading={verb.reading}
              gloss={verb.gloss}
              glossMode="hover"
              role="verb"
              size="sm"
            />
          ))}
        </div>
        <p className="mt-2 text-xs text-stone-500">
          同音不同類的好例子：着る（きる，穿，一段）／切る（きる，切，五段）；変える（かえる，改變，一段）／帰る（かえる，回去，五段）。
        </p>
      </section>

      {/* て形音便規則表 */}
      <section>
        <h2 className="text-lg font-semibold text-stone-800">五段動詞的て／た形音便規則</h2>
        <p className="mt-1 text-xs text-stone-500">
          五段動詞的て形／た形不是單純加語尾，詞尾會依辭書形的最後一個假名產生音便（發音變化）。
        </p>
        <div className="mt-3 overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500">
              <tr>
                <th className="px-3 py-2">辭書形詞尾</th>
                <th className="px-3 py-2">て形</th>
                <th className="px-3 py-2">た形</th>
                <th className="px-3 py-2">備註</th>
              </tr>
            </thead>
            <tbody>
              {ONBIN_ROWS.map((row) => (
                <tr key={row.endings} className="border-t border-stone-100">
                  <td className="px-3 py-2 font-medium text-stone-800">{row.endings}</td>
                  <td className="px-3 py-2 text-stone-700">〜{row.te}</td>
                  <td className="px-3 py-2 text-stone-700">〜{row.ta}</td>
                  <td className="px-3 py-2 text-xs text-stone-500">{row.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
