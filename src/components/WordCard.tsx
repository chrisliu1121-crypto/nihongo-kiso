// WordCard — one 今日單詞 entry (DESIGN.md §12 step 3). The headword and
// each example-sentence token are just Token instances with different
// props (DESIGN.md §5.1 -- "不做三次，做一個"). The example is tokenized
// (see ExampleToken in src/lib/bank/types.ts) rather than one Token per
// sentence specifically so a particle token can pass `particle` through to
// Token/kanaToCells on its own -- feeding a whole sentence through
// kanaToCells at once can't tell は/へ/を apart from an ordinary word, and
// separately risks misreading an unrelated word-boundary vowel pair as a
// long vowel.

import { Token } from "./Token";
import type { Word } from "../lib/bank";

export interface WordCardProps {
  word: Word;
}

export function WordCard({ word }: WordCardProps) {
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <Token
          surface={word.surface}
          reading={word.reading}
          gloss={word.gloss}
          role={word.pos === "動詞" ? "verb" : "noun"}
          size="lg"
          showMorae
          id={word.id}
        />
        <span className="mt-1 shrink-0 rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
          {word.pos}
        </span>
      </div>

      <div className="border-t border-dashed border-stone-200 pt-3">
        <div className="flex flex-wrap items-end gap-1.5">
          {word.example.tokens.map((token, i) => (
            <Token
              key={i}
              surface={token.surface}
              reading={token.reading}
              particle={token.particle}
              role={token.particle ? "particle" : "phrase"}
              size="sm"
              id={`${word.id}:ex:${i}`}
            />
          ))}
        </div>
        <p className="mt-1.5 text-xs text-stone-400">{word.example.zh}</p>
      </div>

      {word.collocations.length > 0 && (
        <p className="text-xs text-stone-400">搭配：{word.collocations.join("、")}</p>
      )}
    </article>
  );
}
