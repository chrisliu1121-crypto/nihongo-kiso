// Foundations demo page: a persistent KanaTable next to a handful of Tokens,
// so hover/click highlighting can actually be exercised by hand. This is a
// scaffold for the real routes (DESIGN.md §3), not a route itself yet.

import { useState } from "react";
import { KanaTable } from "./components/KanaTable";
import { Token } from "./components/Token";
import { buildHighlightSet, clearLayer, setLayer } from "./store/highlight";

interface WordDemo {
  surface: string;
  reading: string;
  gloss: string;
}

const WORDS: WordDemo[] = [
  { surface: "学校", reading: "がっこう", gloss: "學校" },
  { surface: "東京", reading: "とうきょう", gloss: "東京" },
  { surface: "客", reading: "きゃく", gloss: "客人" },
  { surface: "ラーメン", reading: "らーめん", gloss: "拉麵" },
  { surface: "雑誌", reading: "ざっし", gloss: "雜誌" },
  { surface: "ここ", reading: "ここ", gloss: "這裡" },
  { surface: "新聞", reading: "しんぶん", gloss: "報紙" },
];

const PARTICLES = ["は", "が", "を", "に", "で", "と", "の", "も"];

export function App() {
  const [contextOn, setContextOn] = useState(false);

  const toggleContext = () => {
    if (contextOn) {
      clearLayer("context");
      setContextOn(false);
      return;
    }
    const allReadings = WORDS.map((w) => w.reading).join("") + PARTICLES.join("");
    setLayer("context", buildHighlightSet("page", allReadings));
    setContextOn(true);
  };

  return (
    <div className="min-h-screen bg-stone-50 text-stone-800">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8 lg:flex-row lg:items-start">
        <aside className="lg:sticky lg:top-8 lg:w-[22rem] lg:shrink-0">
          <KanaTable />
        </aside>

        <main className="flex-1 space-y-8">
          <header>
            <h1 className="text-2xl font-bold text-stone-900">nihongo-kiso · 地基 demo</h1>
            <p className="mt-2 max-w-prose text-sm leading-relaxed text-stone-600">
              滑過（hover）任一個字會在左側五十音表上預覽對應假名；點一下（click）會把它釘選住，再點一次取消。
              下方每個單詞也可以把滑鼠移到逐拍小字上，只高亮那一拍。
            </p>
          </header>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
              單詞（hover 逐拍）
            </h2>
            <div className="flex flex-wrap gap-3">
              {WORDS.map((word) => (
                <Token
                  key={word.reading}
                  surface={word.surface}
                  reading={word.reading}
                  gloss={word.gloss}
                  role="noun"
                  size="md"
                  showMorae
                />
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
              助詞（は 顯示 wa、を 顯示 o）
            </h2>
            <div className="flex flex-wrap gap-2">
              {PARTICLES.map((particle) => (
                <Token
                  key={particle}
                  surface={particle}
                  reading={particle}
                  role="particle"
                  size="sm"
                />
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
              sourceId 獨立性
            </h2>
            <div className="flex flex-wrap gap-2">
              <Token surface="は" reading="は" role="particle" size="sm" />
              <Token surface="は" reading="は" role="particle" size="sm" />
            </div>
            <p className="mt-2 max-w-prose text-xs text-stone-500">
              上面兩個 は 完全沒有傳 <code>id</code>，文字也完全相同，但各自有自己的實例 id
              （React <code>useId()</code>）——兩個 は 各自獨立釘選：點第一個釘選它，再點第二個釘選它，
              第一個應該仍保持釘選，不會被第二個取消掉。
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
              Context 層
            </h2>
            <button
              type="button"
              onClick={toggleContext}
              className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 transition-colors duration-150 hover:bg-amber-100"
            >
              {contextOn ? "清除 context 層" : "設定 context 層（本頁全部假名）"}
            </button>
            <p className="mt-2 max-w-prose text-xs text-stone-500">
              用來驗證三層可以同時疊加：開著 context 層時再去 hover／點選上面的單詞或助詞，
              可以看到 hover／pinned 蓋過 context 的淡色底。
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}
