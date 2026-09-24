// SentenceLine — one grammar-seed Sentence rendered as a row of Tokens
// (build task 2026-09 step 4). Every token is just a Token instance
// (DESIGN.md §5.1 -- "不做三次，做一個"), so the gojuon table lights up for
// free the same way it already does for WordCard's example row.

import { Token } from "./Token";
import type { Sentence } from "../lib/bank";

export interface SentenceLineProps {
  sentence: Sentence;
  /** Optional context line shown under the translation (e.g. a contrast pair's note). */
  note?: string;
  size?: "sm" | "md";
}

export function SentenceLine({ sentence, note, size = "sm" }: SentenceLineProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-end gap-1.5">
        {sentence.tokens.map((token, i) =>
          token.reading === "" ? (
            // Punctuation token (、。「」…): plain text, lights nothing.
            <span key={i} className="self-start pt-1 text-lg text-stone-500">
              {token.surface}
            </span>
          ) : (
            <Token
              key={i}
              surface={token.surface}
              reading={token.reading}
              particle={token.particle}
              gloss={token.gloss}
              role={token.particle ? "particle" : "phrase"}
              size={size}
              id={`${sentence.id}:${i}`}
            />
          ),
        )}
      </div>
      <p className="text-xs text-stone-500">{sentence.translation}</p>
      {note && <p className="text-xs text-amber-700">{note}</p>}
    </div>
  );
}
