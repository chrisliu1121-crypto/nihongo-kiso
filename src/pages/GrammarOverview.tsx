// GrammarOverview — "/grammar": word-order skeleton + the grammar-item
// overview, grouped by category (build task 2026-09-24 §D, generalizing the
// original 8-particle overview from build task 2026-09 step 4, DESIGN.md
// §2.2/§2.3/§2.4). The word-order skeleton, the "three good news" block, and
// the は/が + other contrast sections are unchanged in substance (still
// transcribed from DESIGN.md); only the particle-card wall below them is now
// driven entirely by bank.grammar.items (grouped by GrammarCategory) instead
// of a hardcoded 8-particle list, so a future content author adding a new
// item to data/grammar/items.json never has to touch this page.
//
// Every example sentence renders through SentenceLine/Token so the gojuon
// table highlights for free (DESIGN.md §5.1).

import { Link } from "react-router-dom";
import { Token } from "../components/Token";
import { ContrastSetView } from "../components/ContrastSetView";
import type { ContrastSetPair } from "../components/ContrastSetView";
import bank, { getGrammarContrastSet, getSentence, itemsByCategory } from "../lib/bank";
import type { ContrastSet, GrammarCategory, GrammarItem, Sentence } from "../lib/bank";

const SKELETON_SENTENCE_ID = "s_g033";

const SKELETON_LABELS = ["主題は", "時間", "地點で", "對象と／に", "受詞を", "動詞"];

/** Display order + Chinese label + one-line description for each GrammarCategory (build task 2026-09-24 §D). */
const CATEGORY_ORDER: GrammarCategory[] = ["case", "focus", "conjunctive", "final", "conjunction", "expression"];

const CATEGORY_LABEL: Record<GrammarCategory, string> = {
  case: "格助詞",
  focus: "係助詞・副助詞",
  conjunctive: "接續助詞",
  final: "終助詞",
  conjunction: "接續詞",
  expression: "副詞・表現",
};

const CATEGORY_DESCRIPTION: Record<GrammarCategory, string> = {
  case: "標記名詞在句中扮演的角色（誰、對誰、在哪裡、用什麼…）",
  focus: "標記這句話在談什麼、強調什麼、限定什麼範圍",
  conjunctive: "連接兩個子句，說明原因、轉折、假設等關係",
  final: "加在句尾，表示語氣（確認、提醒、感嘆…）",
  conjunction: "連接兩個句子，是句子之間的橋樑，不是助詞",
  expression: "副詞或固定表現，常與特定語氣或句型搭配",
};

interface SlotToken {
  surface: string;
  reading: string;
  gloss: string;
  particle?: boolean;
  id: string;
}

/**
 * The individual tokens making up one bunsetsu slot, each still routed
 * through kanaToCells on its OWN reading (DESIGN.md §7: concatenating a
 * word token's reading with its particle's and converting the combined
 * string as one Token would apply the particle override to every bare
 * は/へ mora in the whole string -- e.g. 朝ご飯 (あさごはん) + を merged
 * into one reading turned ごはん's は into "wa", producing "asagowan'o"
 * instead of "asagohan" + "o". The slot box below is purely visual
 * grouping; each token inside it is its own Token instance).
 */
function bunsetsuTokens(sentence: Sentence, bunsetsuIndex: number): SlotToken[] {
  // The skeleton sentence (s_g033) is hand-authored WITH bunsetsu (it's also
  // used by the old arrange-practice seed set) -- the `!` reflects that,
  // not a general guarantee every Sentence has bunsetsu (build task
  // 2026-09-24 §A made that field optional).
  return sentence.bunsetsu![bunsetsuIndex].map((tokenIndex) => {
    const token = sentence.tokens[tokenIndex];
    return {
      surface: token.surface,
      reading: token.reading,
      gloss: token.gloss,
      particle: token.particle,
      id: `${sentence.id}:${tokenIndex}`,
    };
  });
}

function slotBoxClass(index: number): string {
  if (index === 0) return "border-amber-300 bg-amber-50"; // 主題 -- 可省略
  if (index === SKELETON_LABELS.length - 1) return "border-stone-400 bg-stone-100"; // 動詞 -- 不可動
  return "border-sky-200 bg-sky-50"; // 時間/地點/對象/受詞 -- 可互換
}

function resolvePairs(cs: ContrastSet): ContrastSetPair[] {
  return cs.pairs.map((p) => {
    const sentence = getSentence(bank, p.sentence_id);
    if (!sentence) {
      throw new Error(`GrammarOverview: contrast set ${cs.id} references missing sentence ${p.sentence_id}`);
    }
    return { sentence, note: p.note };
  });
}

interface ContrastBlockProps {
  id: string;
}

function ContrastBlock({ id }: ContrastBlockProps) {
  const cs = getGrammarContrastSet(bank, id);
  if (!cs) return null;
  return <ContrastSetView contrastSet={cs} pairs={resolvePairs(cs)} />;
}

interface GrammarItemCardProps {
  item: GrammarItem;
  large?: boolean;
}

function GrammarItemCard({ item, large }: GrammarItemCardProps) {
  return (
    <Link
      to={`/grammar/${item.id}`}
      className={`flex flex-col gap-2 rounded-xl border p-4 shadow-sm transition-colors duration-150 hover:border-amber-300 hover:bg-amber-50/40 ${
        large ? "border-amber-300 bg-amber-50/60 sm:col-span-2" : "border-stone-200 bg-white"
      }`}
    >
      <Token
        surface={item.surface}
        reading={item.reading}
        role={item.cell ? "particle" : "phrase"}
        particle={!!item.cell}
        interactive={false}
        size={large ? "lg" : "md"}
      />
      <p className="text-sm text-stone-700">{item.core}</p>
      {item.zh_bridge && <p className="text-xs text-stone-500">{item.zh_bridge}</p>}
    </Link>
  );
}

/**
 * One category section of the card wall. The heading always renders (all
 * six categories, build task 2026-09-24's own acceptance check #3: "/grammar
 * ... 含六個分類標題") -- only the card grid is conditional, so a category a
 * future content author hasn't filled in yet (接續詞、副詞・表現, ...) shows
 * as an empty-but-labeled section instead of silently disappearing.
 */
function CategorySection({ category }: { category: GrammarCategory }) {
  const items = itemsByCategory(bank, category);
  const heavy = items.filter((it) => it.weight === "heavy");
  const rest = items.filter((it) => it.weight !== "heavy");
  return (
    <div>
      <p className="mb-1 text-sm font-semibold text-stone-600">{CATEGORY_LABEL[category]}</p>
      <p className="mb-2 text-xs text-stone-400">{CATEGORY_DESCRIPTION[category]}</p>
      {items.length === 0 ? (
        <p className="text-xs text-stone-400 italic">（尚未收錄）</p>
      ) : (
        <>
          {heavy.length > 0 && (
            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              {heavy.map((it) => (
                <GrammarItemCard key={it.id} item={it} large />
              ))}
            </div>
          )}
          {rest.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {rest.map((it) => (
                <GrammarItemCard key={it.id} item={it} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function GrammarOverview() {
  const skeleton = getSentence(bank, SKELETON_SENTENCE_ID);

  return (
    <div className="space-y-10">
      {/* 1. 語序 -- DESIGN.md §2.2 */}
      <section>
        <h1 className="text-2xl font-bold text-stone-900">語序</h1>
        <blockquote className="mt-3 rounded-lg border-l-4 border-amber-300 bg-amber-50/60 px-4 py-3 text-stone-700">
          中文靠位置決定角色，日語靠助詞決定角色。日語唯一硬性的位置規則是「動詞在最後」。
        </blockquote>
      </section>

      {/* 2. 骨架圖 -- DESIGN.md §2.2 */}
      {skeleton && (
        <section>
          <div className="grid grid-cols-6 gap-2">
            {SKELETON_LABELS.map((label) => (
              <div key={label} className="text-center text-xs text-stone-400">
                {label}
              </div>
            ))}
            {SKELETON_LABELS.map((_, i) => {
              const tokens = bunsetsuTokens(skeleton, i);
              return (
                <div
                  key={`${skeleton.id}:slot:${i}`}
                  className={`flex flex-wrap items-center justify-center gap-1 rounded-lg border p-1.5 ${slotBoxClass(i)}`}
                >
                  {tokens.map((t) => (
                    <Token
                      key={t.id}
                      surface={t.surface}
                      reading={t.reading}
                      gloss={t.gloss}
                      particle={t.particle}
                      role={t.particle ? "particle" : "phrase"}
                      size="sm"
                      id={t.id}
                    />
                  ))}
                </div>
              );
            })}
            <div className="col-span-1 text-center text-xs text-stone-400">可省略</div>
            <div className="col-span-4 text-center text-xs text-stone-400">
              ←—— 這段順序可互換，語感有別 ——→
            </div>
            <div className="col-span-1 text-center text-xs text-stone-400">不可動</div>
          </div>
          <p className="mt-2 text-xs text-stone-400">示範句：{skeleton.ja}（{skeleton.translation}）</p>
        </section>
      )}

      {/* 3. 三個好消息、一個壞消息 -- DESIGN.md §2.2 */}
      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <p className="text-sm text-stone-700">給中文母語者的三個好消息：</p>
        <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-stone-600">
          <li>修飾語在被修飾語之前（同中文）</li>
          <li>
            主題—評論結構中文也有（「這本書啊，我看過了」≈ この本は読んだ）
          </li>
          <li>沒有數、性、冠詞的變化</li>
        </ul>
        <p className="mt-2 text-sm text-stone-700">壞消息只有助詞一項。</p>
      </section>

      {/* 4. 文法項目卡片牆，依 category 分組 -- 完全來自 bank.grammar.items，
          新增項目不需改這個頁面（build task 2026-09-24 §D） */}
      <section>
        <h2 className="text-xl font-bold text-stone-900">文法項目</h2>
        <div className="mt-3 space-y-5">
          {CATEGORY_ORDER.map((cat) => (
            <CategorySection key={cat} category={cat} />
          ))}
        </div>

        <Link
          to="/grammar/verbs"
          className="mt-5 flex flex-col gap-1 rounded-xl border border-sky-200 bg-sky-50 p-4 shadow-sm transition-colors duration-150 hover:border-sky-300 hover:bg-sky-100/60"
        >
          <span className="text-sm font-semibold text-stone-800">動詞：五段・一段・不規則 →</span>
          <span className="text-xs text-stone-500">動詞分類與活用（ます形／ない形／て形／た形）</span>
        </Link>
      </section>

      {/* 5. 為什麼 は 和 が 難 -- DESIGN.md §2.3 */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold text-stone-900">為什麼 は 和 が 難</h2>
        <p className="text-sm text-stone-700">
          は 和 が 難，不是因為相似，而是因為根本不同層：が 說「誰做的」，は
          說「這句在談誰」。中文使用者有現成直覺（「這本書我看過了」的「這本書」就是
          は，只是沒人指出來）。
        </p>
        <ContrastBlock id="cs_wa_ga" />
        <ContrastBlock id="cs_wa_ga_double" />
      </section>

      {/* 6. 其餘對照組 -- DESIGN.md §2.4 */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold text-stone-900">更多助詞對照</h2>
        <ContrastBlock id="cs_ni_de" />
        <ContrastBlock id="cs_ni_de_live" />
        <ContrastBlock id="cs_to_ni" />
        <ContrastBlock id="cs_wo_ga_tai" />
      </section>
    </div>
  );
}
