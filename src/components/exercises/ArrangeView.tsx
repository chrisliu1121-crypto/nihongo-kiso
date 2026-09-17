// ArrangeView — the "arrange" exercise renderer (build task 2026-09 step 5,
// DESIGN.md §2.2/§8.5 "排列練習"). Registered in registry.tsx's ExerciseView
// dispatch. Every block is a bunsetsu (DESIGN.md §6's yoon/pratice unit --
// here, chunksOf's Chunk), and judging is three-way (natural/acceptable/
// invalid, see src/lib/exercise/arrange.ts's own header) because DESIGN.md
// §2.2 makes "動詞在最後" the only hard position rule -- there is no single
// correct order to diff against.
//
// PINNED-LAYER EXCEPTION: src/store/highlight.ts's own header comment says
// "Token.tsx is the ONLY thing in the app that calls setLayer/togglePinned
// for hover/pinned" -- that file is intentionally left untouched by this
// build task, so its comment is now slightly stale. This component is the
// ONE other place allowed to call setLayer("pinned", ...) directly: the
// fully-arranged sentence is the LEARNER'S OWN PRODUCT (every chunk placed
// by hand across possibly many clicks), not a single Token's click target,
// so it needs one merged HighlightSet spanning every placed token, built
// once the arrangement is complete. It never touches "hover". Individual
// Tokens inside a chunk still fire their own pin-toggle on click (that's
// baked into Token itself and not something this file can suppress without
// forking Token) -- harmless, since completing the arrangement immediately
// overwrites "pinned" with the merged set below.

import { useEffect, useMemo, useState } from "react";
import { Token } from "../Token";
import bank, { getSentence } from "../../lib/bank";
import { buildContextFromTokens, chunksOf, judgeArrange, shuffleChunks } from "../../lib/exercise";
import type { ArrangeExercise, Chunk } from "../../lib/exercise";
import { clearLayer, setLayer } from "../../store/highlight";

export interface ArrangeViewProps {
  exercise: ArrangeExercise;
}

/** Small deterministic string hash, just to turn each exercise's own id into a distinct (but stable across renders) shuffle seed -- see shuffleChunks' own doc for why determinism matters. */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

function ChunkBox({ chunk, onClick }: { chunk: Chunk; onClick: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      className={`flex min-h-11 cursor-pointer items-center gap-0.5 rounded-lg border p-1 transition-colors duration-150 ${
        chunk.isPredicate
          ? "border-stone-400 bg-stone-100 hover:bg-stone-200"
          : "border-sky-200 bg-sky-50 hover:bg-sky-100"
      }`}
    >
      {chunk.tokens.map((token, i) => (
        <Token
          key={i}
          surface={token.surface}
          reading={token.reading}
          gloss={token.gloss}
          particle={token.particle}
          role={token.particle ? "particle" : "phrase"}
          size="sm"
        />
      ))}
    </div>
  );
}

export function ArrangeView({ exercise }: ArrangeViewProps) {
  const sentence = getSentence(bank, exercise.sentence_id);
  const [order, setOrder] = useState<number[]>([]);
  const [reshuffleNonce, setReshuffleNonce] = useState(0);
  const [revealed, setRevealed] = useState(false);

  // A different exercise (question switch) always starts fresh -- but
  // must NOT re-run just because `order` itself changed.
  useEffect(() => {
    setOrder([]);
    setReshuffleNonce(0);
    setRevealed(false);
  }, [exercise.id]);

  // Context layer: every kana this exercise's sentence touches, background
  // only (DESIGN.md §5.2). Cleared on question switch / unmount, along with
  // whatever "pinned" set this exercise may have set (see PINNED-LAYER
  // EXCEPTION above and DESIGN.md §8.5's "重排時清").
  useEffect(() => {
    if (!sentence) return;
    setLayer("context", buildContextFromTokens(exercise.id, sentence.tokens));
    return () => {
      clearLayer("context");
      clearLayer("pinned");
    };
  }, [exercise.id, sentence]);

  const chunks = useMemo(() => (sentence ? chunksOf(sentence) : []), [sentence]);
  const pool = useMemo(
    () =>
      sentence
        ? shuffleChunks(chunks, hashString(exercise.id) + reshuffleNonce, sentence.preferred_order)
        : [],
    [chunks, sentence, exercise.id, reshuffleNonce],
  );

  const chunkByIndex = useMemo(() => new Map(chunks.map((c) => [c.index, c])), [chunks]);
  const poolChunks = pool.filter((c) => !order.includes(c.index));
  const placedChunks = order.map((i) => chunkByIndex.get(i)).filter((c): c is Chunk => c !== undefined);

  const complete = sentence !== undefined && chunks.length > 0 && order.length === chunks.length;
  const verdict = complete && sentence ? judgeArrange(sentence, order) : null;

  // Once the whole sentence is placed, pin the merged set of every token in
  // it (see PINNED-LAYER EXCEPTION above).
  useEffect(() => {
    if (!complete) return;
    const orderedTokens = order.flatMap((i) => chunkByIndex.get(i)?.tokens ?? []);
    setLayer("pinned", buildContextFromTokens(exercise.id, orderedTokens));
  }, [complete, order, chunkByIndex, exercise.id]);

  if (!sentence) {
    return (
      <p className="rounded-lg border border-dashed border-stone-300 bg-white p-6 text-sm text-stone-500">
        找不到這題引用的句子（{exercise.sentence_id}）。
      </p>
    );
  }

  function place(index: number): void {
    setOrder((prev) => [...prev, index]);
  }
  function takeBack(index: number): void {
    setOrder((prev) => prev.filter((i) => i !== index));
  }
  function reshuffle(): void {
    setOrder([]);
    setRevealed(false);
    clearLayer("pinned");
    setReshuffleNonce((n) => n + 1);
  }

  const preferredSurface = sentence.preferred_order
    .map((i) => chunkByIndex.get(i)?.tokens.map((t) => t.surface).join(""))
    .join("");

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-stone-800">{exercise.prompt_zh}</h2>
        {!exercise.verified && (
          <span className="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-400">未校對</span>
        )}
      </header>

      {exercise.hints.length > 0 && (
        <p className="text-xs text-stone-400">提示：{exercise.hints.join("；")}</p>
      )}

      <section>
        <p className="mb-1 text-xs font-medium text-stone-500">你的句子</p>
        <div className="flex min-h-[3.5rem] flex-wrap items-center gap-2 rounded-lg border border-dashed border-stone-300 bg-white p-3">
          {placedChunks.length === 0 && (
            <span className="text-xs text-stone-300">點下面的積木開始排列</span>
          )}
          {placedChunks.map((chunk) => (
            <ChunkBox key={chunk.index} chunk={chunk} onClick={() => takeBack(chunk.index)} />
          ))}
        </div>
      </section>

      <section>
        <p className="mb-1 text-xs font-medium text-stone-500">積木池</p>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3">
          {poolChunks.length === 0 && <span className="text-xs text-stone-300">（已全部放完）</span>}
          {poolChunks.map((chunk) => (
            <ChunkBox key={chunk.index} chunk={chunk} onClick={() => place(chunk.index)} />
          ))}
        </div>
      </section>

      {verdict && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            verdict.kind === "natural"
              ? "border-emerald-300 bg-emerald-50 text-emerald-800"
              : verdict.kind === "acceptable"
                ? "border-amber-300 bg-amber-50 text-amber-800"
                : "border-rose-300 bg-rose-50 text-rose-800"
          }`}
        >
          {verdict.kind === "natural" && <p>✅ 正確且自然</p>}
          {verdict.kind === "acceptable" && <p>◐ {verdict.note}</p>}
          {verdict.kind === "invalid" && <p>✗ {verdict.note}</p>}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={reshuffle}
          className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-600 transition-colors duration-150 hover:border-amber-300 hover:bg-amber-50/60"
        >
          重排
        </button>
        <button
          type="button"
          onClick={() => setRevealed((r) => !r)}
          className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-600 transition-colors duration-150 hover:border-amber-300 hover:bg-amber-50/60"
        >
          {revealed ? "隱藏答案" : "看答案"}
        </button>
      </div>

      {revealed && <p className="text-xs text-stone-500">參考答案：{preferredSurface}</p>}
    </div>
  );
}
