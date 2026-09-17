// ParticleSwapView — the "particle-swap" exercise renderer (build task
// 2026-09 step 5, DESIGN.md §2.4/§8.5 "助詞對照器"). Registered in
// registry.tsx's ExerciseView dispatch.
//
// This is deliberately NOT multiple choice: selecting a candidate never
// marks anything "wrong" except the genuinely `invalid` ones -- several
// candidates can be simultaneously grammatical with different meanings
// (DESIGN.md §2.4: "好幾個都對，但講的是不同的事"). Only the "context"
// highlight layer is SET here (the full sentence's kana, background only).
// Every candidate chip is rendered with pinnable={false} (Token.tsx's own
// doc explains why: without it, clicking a candidate to select it would
// ALSO toggle that Token's own pin, leaving a stray single-particle
// highlight on the gojuon table). "pinned" is only ever CLEARED by this
// view (belt-and-suspenders on question switch/unmount, same as
// ArrangeView), never set -- "hover" stays exclusively Token's own job.

import { useEffect, useState } from "react";
import { Token } from "../Token";
import bank, { getParticle, getSentence } from "../../lib/bank";
import type { ParticleId } from "../../lib/bank";
import { applyCandidate, buildContextFromTokens, resolveSwap } from "../../lib/exercise";
import type { ParticleSwapExercise, SwapVerdict } from "../../lib/exercise";
import { clearLayer, setLayer } from "../../store/highlight";

export interface ParticleSwapViewProps {
  exercise: ParticleSwapExercise;
}

const VERDICT_META: Record<SwapVerdict, { badge: string; label: string; classes: string }> = {
  natural: { badge: "✅", label: "自然", classes: "border-emerald-300 bg-emerald-50 text-emerald-800" },
  different: { badge: "🔁", label: "語意不同", classes: "border-sky-300 bg-sky-50 text-sky-800" },
  marginal: { badge: "◐", label: "勉強", classes: "border-amber-300 bg-amber-50 text-amber-800" },
  invalid: { badge: "✗", label: "不成立", classes: "border-rose-300 bg-rose-50 text-rose-800" },
};

export function ParticleSwapView({ exercise }: ParticleSwapViewProps) {
  const sentence = getSentence(bank, exercise.sentence_id);
  const naturalCandidate =
    exercise.candidates.find((c) => c.verdict === "natural") ?? exercise.candidates[0];
  const [selected, setSelected] = useState<ParticleId>(naturalCandidate.particle_id);

  // Reset to this exercise's own natural candidate whenever the exercise
  // (question) itself changes -- not on every render.
  useEffect(() => {
    setSelected(naturalCandidate.particle_id);
    // naturalCandidate is recomputed from exercise.candidates every render;
    // exercise.id alone is what actually identifies "a different question".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise.id]);

  useEffect(() => {
    if (!sentence) return;
    setLayer("context", buildContextFromTokens(exercise.id, sentence.tokens));
    // Every candidate chip below is a pinnable={false} Token (see Token.tsx's
    // own doc on that prop), so nothing in this view should ever set
    // "pinned" itself -- but a stray pin from elsewhere (or a future regression)
    // must not survive a question switch or leaving this page, same as
    // ArrangeView's own cleanup.
    return () => {
      clearLayer("context");
      clearLayer("pinned");
    };
  }, [exercise.id, sentence]);

  if (!sentence) {
    return (
      <p className="rounded-lg border border-dashed border-stone-300 bg-white p-6 text-sm text-stone-500">
        找不到這題引用的句子（{exercise.sentence_id}）。
      </p>
    );
  }

  const selectedParticle = getParticle(bank, selected);
  const displayTokens = selectedParticle
    ? applyCandidate(sentence, exercise.slot_token_index, selectedParticle)
    : sentence.tokens;
  const candidate = resolveSwap(exercise, selected);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-stone-800">助詞對照：{sentence.translation}</h2>
        {!exercise.verified && (
          <span className="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-400">未校對</span>
        )}
      </header>

      <div className="flex flex-wrap items-end gap-1.5 rounded-lg border border-stone-200 bg-white p-3">
        {displayTokens.map((token, i) => (
          <div
            key={i}
            className={
              i === exercise.slot_token_index
                ? "rounded-lg border-2 border-amber-400 p-0.5"
                : "p-0.5"
            }
          >
            <Token
              surface={token.surface}
              reading={token.reading}
              gloss={token.gloss}
              particle={token.particle}
              role={token.particle ? "particle" : "phrase"}
              size="sm"
            />
          </div>
        ))}
      </div>

      <section>
        <p className="mb-1 text-xs font-medium text-stone-500">換一個助詞試試看</p>
        <div className="flex flex-wrap gap-2">
          {exercise.candidates.map((c) => {
            const particle = getParticle(bank, c.particle_id);
            if (!particle) return null;
            const isFocus = exercise.focus.includes(c.particle_id);
            const isSelected = c.particle_id === selected;
            return (
              <div
                key={c.particle_id}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                onClick={() => setSelected(c.particle_id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelected(c.particle_id);
                  }
                }}
                className={`flex min-h-11 cursor-pointer items-center rounded-lg p-0.5 transition-colors duration-150 ${
                  isFocus ? "border-2 border-stone-400" : "border border-transparent"
                } ${isSelected ? "ring-2 ring-amber-400" : ""}`}
              >
                <Token
                  surface={particle.surface}
                  reading={particle.reading}
                  romaji={particle.romaji}
                  role="particle"
                  particle
                  size="md"
                  pinnable={false}
                />
              </div>
            );
          })}
        </div>
      </section>

      {candidate && (
        <div className={`rounded-lg border p-3 text-sm ${VERDICT_META[candidate.verdict].classes}`}>
          <p className="font-medium">
            {VERDICT_META[candidate.verdict].badge} {VERDICT_META[candidate.verdict].label}
            {candidate.translation && <span className="ml-2 font-normal">{candidate.translation}</span>}
          </p>
          <p className="mt-1 text-xs opacity-80">{candidate.note}</p>
        </div>
      )}
    </div>
  );
}
