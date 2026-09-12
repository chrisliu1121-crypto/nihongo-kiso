// ContrastSetView — one particle contrast_set rendered as a title/summary
// plus its example sentence pairs side by side (build task 2026-09 step 4,
// DESIGN.md §2.4/§8.4). Sentences are resolved by the caller (GrammarOverview
// / ParticlePage), not looked up here, so this stays a pure presentational
// component like WordCard/SentenceLine.

import { SentenceLine } from "./SentenceLine";
import type { ContrastSet, Sentence } from "../lib/bank";

export interface ContrastSetPair {
  sentence: Sentence;
  note: string;
}

export interface ContrastSetViewProps {
  contrastSet: ContrastSet;
  pairs: ContrastSetPair[];
}

export function ContrastSetView({ contrastSet, pairs }: ContrastSetViewProps) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <h3 className="text-base font-semibold text-stone-800">{contrastSet.title}</h3>
      <p className="mt-1 text-sm text-stone-500">{contrastSet.summary}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {pairs.map(({ sentence, note }) => (
          <div key={sentence.id} className="rounded-lg border border-stone-100 bg-stone-50 p-3">
            <SentenceLine sentence={sentence} note={note} />
          </div>
        ))}
      </div>
    </section>
  );
}
