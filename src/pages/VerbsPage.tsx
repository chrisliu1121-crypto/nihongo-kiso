// VerbsPage — "/grammar/verbs": verb classification (五段・一段・不規則) +
// conjugation table (build task 2026-09-24 §C/§D). Reads data/grammar/verbs.json
// directly (like kana.json elsewhere, Vite/vitest both handle a plain JSON
// import) -- this data isn't part of data/bank.json, it has no per-word
// derived fields the way daily words do, so there's nothing build-bank.ts
// needs to compute for it.

import { useMemo, useState } from "react";
import { Token } from "../components/Token";
import { conjugate } from "../lib/grammar/conjugate";
import type { VerbClass, VerbForm } from "../lib/grammar/conjugate";
import verbsData from "../../data/grammar/verbs.json";

interface VerbEntry {
  surface: string;
  reading: string;
  class: VerbClass;
  gloss: string;
}

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
    "辭書形詞尾是う段假名（く・ぐ・す・つ・ぬ・ぶ・む・る・う之一），活用時詞尾在五十音「同一行」的五段之間變化（例：書く／書か（ない）／書き（ます）／書い（て））。",
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

/** Per-form Chinese gloss shown under each Token (build task §C/§D: "gloss 用各形的中文如「寫（禮貌）」「不寫」「寫了」"). */
function formGloss(baseGloss: string, form: VerbForm): string {
  switch (form) {
    case "dictionary":
      return baseGloss;
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
  { endings: "む・ぶ・ぬ", te: "んで", ta: "んだ", note: "連濁：で／だ，不是て／た" },
  { endings: "く", te: "いて", ta: "いた", note: "例外：行く → 行って／行った（不是行いて／行いた）" },
  { endings: "ぐ", te: "いで", ta: "いだ", note: "連濁：で／だ" },
  { endings: "す", te: "して", ta: "した" },
];

const ICHIDAN_EXCEPTIONS = ["帰る", "入る", "走る", "知る", "切る", "要る"];

export function VerbsPage() {
  const byClass = useMemo(() => {
    const map = new Map<VerbClass, VerbEntry[]>();
    for (const cls of CLASS_ORDER) map.set(cls, []);
    for (const v of verbs) map.get(v.class)!.push(v);
    return map;
  }, []);

  const [selectedClass, setSelectedClass] = useState<VerbClass>("godan");
  const classVerbs = byClass.get(selectedClass) ?? [];
  const [selectedSurface, setSelectedSurface] = useState<string>(classVerbs[0]?.surface ?? "");

  const selectedVerb =
    classVerbs.find((v) => v.surface === selectedSurface) ?? classVerbs[0] ?? verbs[0];

  function selectClass(cls: VerbClass): void {
    setSelectedClass(cls);
    const first = byClass.get(cls)?.[0];
    if (first) setSelectedSurface(first.surface);
  }

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-bold text-stone-900">動詞：五段・一段・不規則</h1>
        <p className="mt-2 text-sm text-stone-600">
          日語動詞依活用方式分三大類。辭書形（字典裡查到的原形）的詞尾看得出線索，但一段動詞有一批例外，要單獨記住。
        </p>
      </section>

      {/* 三類說明 */}
      <section className="grid gap-3 sm:grid-cols-3">
        {CLASS_ORDER.filter((c) => c !== "kuru").map((cls) => (
          <div key={cls} className="rounded-lg border border-stone-200 bg-white p-4">
            <p className="text-sm font-semibold text-stone-800">{CLASS_LABEL[cls]}</p>
            <p className="mt-1 text-xs text-stone-500">{CLASS_DESCRIPTION[cls]}</p>
          </div>
        ))}
        <div className="rounded-lg border border-stone-200 bg-white p-4 sm:col-span-3">
          <p className="text-sm font-semibold text-stone-800">{CLASS_LABEL.kuru}</p>
          <p className="mt-1 text-xs text-stone-500">{CLASS_DESCRIPTION.kuru}</p>
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
        <div className="mt-2 flex flex-wrap gap-2">
          {ICHIDAN_EXCEPTIONS.map((surface) => {
            const verb = verbs.find((v) => v.surface === surface);
            if (!verb) return null;
            return (
              <Token
                key={surface}
                surface={verb.surface}
                reading={verb.reading}
                gloss={verb.gloss}
                role="verb"
                size="sm"
              />
            );
          })}
        </div>
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

      {/* 活用表：選類別 -> 選動詞 -> 看五種形 */}
      <section>
        <h2 className="text-lg font-semibold text-stone-800">活用表</h2>

        <div className="mt-3 flex flex-wrap gap-2">
          {CLASS_ORDER.map((cls) => (
            <button
              key={cls}
              type="button"
              onClick={() => selectClass(cls)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
                selectedClass === cls
                  ? "border-amber-400 bg-amber-50 text-amber-800"
                  : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
              }`}
            >
              {CLASS_LABEL[cls]}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {classVerbs.map((v) => (
            <button
              key={v.surface}
              type="button"
              onClick={() => setSelectedSurface(v.surface)}
              className={`rounded-lg border px-2.5 py-1 text-sm transition-colors duration-150 ${
                selectedVerb?.surface === v.surface
                  ? "border-amber-400 bg-amber-50 text-amber-800"
                  : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
              }`}
            >
              {v.surface}
            </button>
          ))}
        </div>

        {selectedVerb && (
          <div className="mt-4 rounded-lg border border-stone-200 bg-white p-4">
            <p className="text-xs text-stone-400">{selectedVerb.gloss}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-5">
              {FORM_ORDER.map((form) => {
                const { surface, reading } = conjugate(selectedVerb, form);
                return (
                  <div key={form} className="flex flex-col items-center gap-1">
                    <span className="text-xs font-medium text-stone-400">{FORM_LABEL[form]}</span>
                    <Token
                      surface={surface}
                      reading={reading}
                      gloss={formGloss(selectedVerb.gloss, form)}
                      role="verb"
                      size="md"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
