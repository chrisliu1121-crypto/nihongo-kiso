// VerbsPage — "/grammar/verbs": verb classification (五段・一段・不規則),
// the conjugation panel, and the 可能形／意向形 rules. Reads
// data/grammar/verbs.json directly (not part of data/bank.json: no per-word
// derived fields for build-bank.ts to compute).
//
// Layout:
//   header + jump menu -> three class cards -> 活用表 (class tabs, the
//   selected verb's panel with 基本形／可能形／意向形 rows, then every verb of
//   that class grouped by ending) -> #potential rules -> #volitional rules ->
//   reference: how to tell 一段 from 五段, て／た音便 table.
// Every verb chip is a Token: hover shows the Chinese gloss bubble and
// highlights its kana on the gojuon table; click selects it for the panel.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Token } from "../components/Token";
import { GrammarJumpSelect } from "../components/GrammarPicker";
import { conjugate } from "../lib/grammar/conjugate";
import type { VerbClass, VerbForm } from "../lib/grammar/conjugate";
import { looksIchidan, verbGroups, type VerbEntry } from "../lib/grammar/verbGroups";
import { formRows, type FormRow } from "../lib/grammar/verbForms";
import { useMediaQuery } from "../lib/ui/useMediaQuery";
import verbsData from "../../data/grammar/verbs.json";

const verbs = (verbsData as { verbs: VerbEntry[] }).verbs;
const verbBySurface = new Map(verbs.map((v) => [v.surface, v]));

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

/** Rule cards for the 可能形 / 意向形 sections: class, rule, and verbs to show as before -> after. */
interface RuleCard {
  cls: string;
  rule: string;
  examples: string[];
}

const POTENTIAL_RULES: RuleCard[] = [
  { cls: "五段", rule: "う段 → え段＋る", examples: ["書く", "話す", "買う", "待つ"] },
  { cls: "一段", rule: "る → られる", examples: ["食べる", "見る"] },
  { cls: "する", rule: "する → できる", examples: ["する", "勉強する"] },
  { cls: "来る", rule: "来る → 来られる（こられる）", examples: ["来る"] },
];

const VOLITIONAL_RULES: RuleCard[] = [
  { cls: "五段", rule: "う段 → お段＋う", examples: ["書く", "話す", "買う", "待つ"] },
  { cls: "一段", rule: "る → よう", examples: ["食べる", "見る"] },
  { cls: "する", rule: "する → しよう", examples: ["する", "勉強する"] },
  { cls: "来る", rule: "来る → 来よう（こよう）", examples: ["来る"] },
];

/** A hand-authored example sentence, rendered token by token (punctuation as plain text). */
interface ExToken {
  surface: string;
  reading: string;
  gloss?: string;
  particle?: boolean;
}

interface Example {
  tokens: ExToken[];
  translation: string;
  note?: string;
}

const P = (surface: string, gloss: string): ExToken => ({ surface, reading: surface, gloss, particle: true });
const COMMA: ExToken = { surface: "、", reading: "" };

const POTENTIAL_EXAMPLES: Example[] = [
  {
    tokens: [
      { surface: "日本語", reading: "にほんご", gloss: "日語" },
      P("が", "（能力的對象）"),
      { surface: "話せます", reading: "はなせます", gloss: "會說" },
    ],
    translation: "我會說日語。",
    note: "原本是 日本語を話す，改成可能形後常用 が",
  },
  {
    tokens: [
      { surface: "明日", reading: "あした", gloss: "明天" },
      P("は", "（主題）"),
      { surface: "来られません", reading: "こられません", gloss: "不能來" },
    ],
    translation: "明天沒辦法來。",
  },
  {
    tokens: [
      { surface: "ここ", reading: "ここ", gloss: "這裡" },
      P("で", "（地點）"),
      { surface: "写真", reading: "しゃしん", gloss: "照片" },
      P("が", "（能力的對象）"),
      { surface: "撮れます", reading: "とれます", gloss: "能拍" },
      P("か", "（疑問）"),
    ],
    translation: "這裡可以拍照嗎？",
  },
];

const VOLITIONAL_EXAMPLES: Example[] = [
  {
    tokens: [
      { surface: "一緒に", reading: "いっしょに", gloss: "一起" },
      { surface: "行こう", reading: "いこう", gloss: "去吧" },
    ],
    translation: "一起去吧！",
    note: "普通體的邀約、提議，對朋友、家人用",
  },
  {
    tokens: [
      { surface: "少し", reading: "すこし", gloss: "稍微" },
      { surface: "休みましょう", reading: "やすみましょう", gloss: "休息吧" },
    ],
    translation: "稍微休息一下吧。",
    note: "〜ましょう 是禮貌的說法",
  },
  {
    tokens: [
      { surface: "窓", reading: "まど", gloss: "窗戶" },
      P("を", "（受詞）"),
      { surface: "開けましょう", reading: "あけましょう", gloss: "打開吧" },
      P("か", "（疑問）"),
    ],
    translation: "要我把窗戶打開嗎？",
    note: "〜ましょうか：主動提議「要不要我…」",
  },
  {
    tokens: [
      { surface: "よし", reading: "よし", gloss: "好" },
      COMMA,
      { surface: "頑張ろう", reading: "がんばろう", gloss: "加油吧" },
    ],
    translation: "好，加油吧。",
    note: "對自己說的決心",
  },
  {
    tokens: [
      { surface: "来年", reading: "らいねん", gloss: "明年" },
      COMMA,
      { surface: "日本", reading: "にほん", gloss: "日本" },
      P("へ", "（方向）"),
      { surface: "行こう", reading: "いこう", gloss: "去" },
      P("と", "（引用）"),
      { surface: "思います", reading: "おもいます", gloss: "想" },
    ],
    translation: "我打算明年去日本。",
    note: "〜（よ）うと思う：打算、想要做某事",
  },
  {
    tokens: [
      { surface: "出かけよう", reading: "でかけよう", gloss: "出門" },
      P("と", "（引用）"),
      { surface: "した", reading: "した", gloss: "做了" },
      { surface: "とき", reading: "とき", gloss: "時候" },
      COMMA,
      { surface: "雨", reading: "あめ", gloss: "雨" },
      P("が", "（主體）"),
      { surface: "降り始めました", reading: "ふりはじめました", gloss: "開始下了" },
    ],
    translation: "正要出門的時候，開始下雨了。",
    note: "〜（よ）うとする：正要、試圖做某事",
  },
];

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

  // /grammar/verbs#potential and #volitional (from the grammar index or the
  // jump menu): react-router doesn't scroll to a hash by itself.
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: "start" });
  }, [hash]);

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
          下方也整理了<a href="#potential" className="text-amber-700 hover:underline">可能形</a>與
          <a href="#volitional" className="text-amber-700 hover:underline">意向形</a>。
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
            滑鼠移到動詞上會顯示中文，五十音表同步高亮；點一下就在上方看它的基本形、可能形和意向形（〜と思う 等延伸說法見下方意向形一節）。
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
            className="scroll-mt-[calc(var(--nav-h)+0.5rem)] space-y-3 rounded-xl border border-amber-200 bg-amber-50/80 p-3 shadow-sm backdrop-blur sm:p-4 lg:sticky lg:top-[calc(var(--nav-h)+0.5rem)] lg:z-[25]"
          >
            <p className="text-xs text-stone-500">
              <span className="font-semibold text-stone-800">{selectedVerb.surface}</span>
              <span className="mx-1.5">·</span>
              {selectedVerb.gloss}
              {looksIchidan(selectedVerb) && (
                <span className="ml-2 rounded bg-amber-200/70 px-1.5 py-0.5 text-[11px] text-amber-900">看似一段，其實五段</span>
              )}
            </p>
            {formRows(selectedVerb).map((row) => (
              <PanelRow key={row.key} row={row} />
            ))}
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
                    romaji={v.romaji}
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

      {/* 可能形 */}
      <section id="potential" className="scroll-mt-[calc(var(--nav-h)+1rem)] space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-stone-800">可能形：「能…、會…」</h2>
          <p className="mt-1 text-sm text-stone-600">表示有能力做、或在某個條件下可以做。</p>
        </div>
        <RuleCards cards={POTENTIAL_RULES} form="potential" />
        <ul className="list-inside list-disc space-y-1.5 text-sm text-stone-700">
          <li>
            可能形本身是一個<strong>一段動詞</strong>，後面照一段活用：書ける → 書けます／書けない／書けて／書けた。
          </li>
          <li>
            原本用 を 的受詞，改成可能形後常換成 <strong>が</strong>：日本語を話す → 日本語<strong>が</strong>話せる（用 を 也不算錯，が 較常見）。
          </li>
          <li>
            口語常把一段動詞和来る的 られる 說成 れる（「ら抜き言葉」）：見れる、食べれる、来れる。聽得懂就好，考試和正式場合用 られる。
          </li>
          <li>一段動詞的可能形和被動形長得一樣：食べられる 可以是「能吃」，也可以是「被吃」，要看上下文。</li>
          <li>
            表示狀態或自然現象、不是自己能控制的動詞（ある、分かる、見える、降る…）沒有可能形；活用表上會直接說明。
          </li>
        </ul>
        <ExampleList examples={POTENTIAL_EXAMPLES} />
      </section>

      {/* 意向形 */}
      <section id="volitional" className="scroll-mt-[calc(var(--nav-h)+1rem)] space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-stone-800">意向形：「…吧」「打算…」</h2>
          <p className="mt-1 text-sm text-stone-600">
            表示說話者的意志：邀對方一起做、自己下決心，或接上其他說法表示打算、嘗試。
          </p>
        </div>
        <RuleCards cards={VOLITIONAL_RULES} form="volitional" />
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500">
              <tr>
                <th className="px-3 py-2">說法</th>
                <th className="px-3 py-2">意思</th>
                <th className="px-3 py-2">例</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["〜（よ）う", "…吧（普通體邀約、下決心）", "行こう、食べよう"],
                ["〜ましょう", "…吧（禮貌）", "行きましょう"],
                ["〜ましょうか", "要不要…？／要我…嗎？", "手伝いましょうか"],
                ["〜（よ）うと思う", "打算…", "行こうと思います"],
                ["〜（よ）うとする", "正要…、試圖…", "出かけようとした"],
              ].map(([form, meaning, ex]) => (
                <tr key={form} className="border-t border-stone-100">
                  <td className="px-3 py-2 font-medium text-stone-800">{form}</td>
                  <td className="px-3 py-2 text-stone-700">{meaning}</td>
                  <td className="px-3 py-2 text-stone-500">{ex}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ExampleList examples={VOLITIONAL_EXAMPLES} />
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
              romaji={verb.romaji}
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

/** One row of the conjugation panel: a title (linking to its rule section) and its forms, or why the verb has none. */
function PanelRow({ row }: { row: FormRow }) {
  return (
    <div className="grid items-start gap-1.5 sm:grid-cols-[4rem_1fr] sm:gap-3">
      <p className="pt-1 text-xs font-semibold text-stone-600">
        {row.anchor ? (
          <a href={`#${row.anchor}`} className="hover:text-amber-700 hover:underline">
            {row.title}
          </a>
        ) : (
          row.title
        )}
      </p>
      {row.missing ? (
        <p className="rounded-md bg-white/70 px-2 py-1.5 text-xs text-stone-500">沒有{row.title}：{row.missing}</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {row.cells.map((c) => (
            <div key={c.label} className="flex min-w-0 flex-col items-center gap-0.5">
              <span className="text-[11px] font-medium text-stone-500">{c.label}</span>
              <Token surface={c.surface} reading={c.reading} romaji={c.romaji} gloss={c.gloss} role="verb" size="sm" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Class-by-class rule cards, each with its example verbs shown as dictionary form -> target form Tokens. */
function RuleCards({ cards, form }: { cards: RuleCard[]; form: Extract<VerbForm, "potential" | "volitional"> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {cards.map((card) => (
        <div key={card.cls} className="rounded-lg border border-stone-200 bg-white p-3">
          <p className="text-sm font-semibold text-stone-800">
            {card.cls}
            <span className="ml-2 text-xs font-normal text-stone-500">{card.rule}</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            {card.examples.map((surface) => {
              const verb = verbBySurface.get(surface);
              if (!verb) return null;
              const out = conjugate(verb, form);
              return (
                <div key={surface} className="flex items-center gap-1.5">
                  <Token surface={verb.surface} reading={verb.reading} romaji={verb.romaji} gloss={verb.gloss} glossMode="hover" role="verb" size="sm" />
                  <span className="text-stone-400">→</span>
                  <Token surface={out.surface} reading={out.reading} role="verb" size="sm" />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function ExampleList({ examples }: { examples: Example[] }) {
  return (
    <div className="space-y-3">
      {examples.map((ex) => (
        <div key={ex.translation} className="rounded-lg border border-stone-100 bg-stone-50 p-3">
          <div className="flex flex-wrap items-end gap-1.5">
            {ex.tokens.map((t, i) =>
              t.reading === "" ? (
                <span key={i} className="self-start pt-1 text-lg text-stone-500">
                  {t.surface}
                </span>
              ) : (
                <Token
                  key={i}
                  surface={t.surface}
                  reading={t.reading}
                  gloss={t.gloss}
                  glossMode="hover"
                  particle={t.particle}
                  role={t.particle ? "particle" : "phrase"}
                  size="sm"
                />
              ),
            )}
          </div>
          <p className="mt-1.5 text-xs text-stone-500">{ex.translation}</p>
          {ex.note && <p className="text-xs text-amber-700">{ex.note}</p>}
        </div>
      ))}
    </div>
  );
}
