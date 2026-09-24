// TextDetail — "/texts/:id": one analyzed text in full. Renders every
// sentence as tokens (Token, glossMode="hover") + a locally-computed romaji
// line + the translation fragments, with hover/tap alignment highlighting
// between a token and the translation fragment(s) it maps to, and a footer
// with the AI's extracted vocab/grammar/particles.
//
// This page (and everything under src/lib/reader/) never drives the
// gojuon-table highlight store directly -- it only ever READS that store's
// state (via the read-only hook) to notice when a Token the user tapped
// became the app-wide highlighted one, so a touch tap on a token can also
// drive this page's OWN, separate alignment-highlight state below. The
// gojuon table itself is unaffected either way.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Token } from "../components/Token";
import { useHighlightState } from "../store/useHighlight";
import { getReaderStore } from "../lib/reader/store";
import { safeRomaji } from "../lib/reader/analyze";
import type { ExtractedVocab, TextDoc } from "../lib/reader/types";
import type { MyWord } from "../lib/reader/types";

type Active =
  | { sentenceIndex: number; kind: "token"; index: number }
  | { sentenceIndex: number; kind: "chunk"; index: number }
  | null;

/** If `sourceId` is one of THIS doc's own token ids ("text:<docId>:<si>:<ti>"), returns its {si, ti}; otherwise null (it's some other Token on the page, or nothing is pinned). */
function parseOwnTokenId(sourceId: string | undefined, docId: string): { si: number; ti: number } | null {
  if (!sourceId) return null;
  const prefix = `text:${docId}:`;
  if (!sourceId.startsWith(prefix)) return null;
  const [siStr, tiStr] = sourceId.slice(prefix.length).split(":");
  const si = Number(siStr);
  const ti = Number(tiStr);
  if (!Number.isInteger(si) || !Number.isInteger(ti)) return null;
  return { si, ti };
}

export function TextDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<TextDoc | null | undefined>(undefined);
  const [titleDraft, setTitleDraft] = useState("");
  const [myWords, setMyWords] = useState<MyWord[]>([]);
  const [active, setActive] = useState<Active>(null);
  const sentenceRefs = useRef<Array<HTMLDivElement | null>>([]);
  const highlightState = useHighlightState();

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const store = getReaderStore();
    store.getText(id).then((found) => {
      if (cancelled) return;
      setDoc(found ?? null);
      setTitleDraft(found?.title ?? "");
    });
    store.listMyWords().then((list) => {
      if (!cancelled) setMyWords(list);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const tappedToken = useMemo(
    () => (doc ? parseOwnTokenId(highlightState.pinned?.sourceId, doc.id) : null),
    [doc, highlightState.pinned],
  );

  function activeTokenIndexFor(sentenceIndex: number): number | null {
    if (active && active.sentenceIndex === sentenceIndex && active.kind === "token") return active.index;
    if (tappedToken && tappedToken.si === sentenceIndex) return tappedToken.ti;
    return null;
  }

  function activeChunkTokenIndicesFor(sentenceIndex: number): number[] | null {
    if (active && active.sentenceIndex === sentenceIndex && active.kind === "chunk" && doc) {
      return doc.sentences[sentenceIndex].translation[active.index]?.token_indices ?? null;
    }
    return null;
  }

  function clearIfSelf(sentenceIndex: number, kind: "token" | "chunk", index: number): void {
    setActive((prev) =>
      prev && prev.sentenceIndex === sentenceIndex && prev.kind === kind && prev.index === index ? null : prev,
    );
  }

  function scrollToSentence(index: number): void {
    sentenceRefs.current[index]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function handleTitleBlur(): Promise<void> {
    if (!doc) return;
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === doc.title) {
      setTitleDraft(doc.title);
      return;
    }
    const updated: TextDoc = { ...doc, title: trimmed, updatedAt: new Date().toISOString() };
    await getReaderStore().putText(updated);
    setDoc(updated);
  }

  async function handleDelete(): Promise<void> {
    if (!doc) return;
    const confirmed = window.confirm(`刪除後無法復原，確定要刪除「${doc.title}」嗎？`);
    if (!confirmed) return;
    await getReaderStore().deleteText(doc.id);
    navigate("/texts");
  }

  async function handleAddWord(vocab: ExtractedVocab): Promise<void> {
    if (!doc) return;
    const { romaji } = safeRomaji(vocab.reading);
    const word = await getReaderStore().addMyWord({
      surface: vocab.surface,
      reading: vocab.reading,
      gloss: vocab.gloss,
      pos: vocab.pos,
      note: vocab.note,
      fromTextId: doc.id,
      fromTextTitle: doc.title,
      romaji,
    });
    setMyWords((prev) => (prev.some((w) => w.id === word.id) ? prev : [word, ...prev]));
  }

  if (doc === undefined) {
    return <p className="text-sm text-stone-400">載入中...</p>;
  }
  if (doc === null) {
    return (
      <p className="rounded-lg border border-dashed border-stone-300 bg-white p-6 text-sm text-stone-500">
        找不到這篇文本，可能已被刪除。{" "}
        <Link to="/texts" className="font-medium text-amber-700 underline">
          回到閱讀列表
        </Link>
      </p>
    );
  }

  const isWordAdded = (v: ExtractedVocab) => myWords.some((w) => w.surface === v.surface && w.reading === v.reading);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => void handleTitleBlur()}
            aria-label="文本標題"
            className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-2xl font-bold text-stone-900 hover:border-stone-200 focus:border-amber-300 focus:bg-white focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void handleDelete()}
            className="shrink-0 rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
          >
            刪除
          </button>
        </div>
        <p className="text-xs text-stone-400">
          {new Date(doc.updatedAt).toLocaleString()} · {doc.sentences.length} 句 · {doc.model}
        </p>
      </header>

      <div className="space-y-5 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        {doc.sentences.map((sentence, si) => {
          const hasInvalid = sentence.tokens.some((t) => t.invalid);
          const chunkTokenIndices = activeChunkTokenIndicesFor(si);

          return (
            <div
              key={si}
              ref={(el) => {
                sentenceRefs.current[si] = el;
              }}
              className="space-y-1.5 border-b border-stone-100 pb-4 last:border-b-0"
            >
              <div className="flex flex-wrap items-end gap-1.5">
                {sentence.tokens.map((token, ti) => {
                  if (token.invalid) {
                    return (
                      <span
                        key={ti}
                        title="這個詞的讀音無法辨識，未加入標音與高亮"
                        className="inline-flex flex-col items-center rounded-lg border border-dashed border-stone-200 px-2 py-1 text-xl font-medium text-stone-700"
                      >
                        {token.surface || "　"}
                      </span>
                    );
                  }
                  const outlined = chunkTokenIndices?.includes(ti) ?? false;
                  return (
                    <span
                      key={ti}
                      onMouseEnter={() => setActive({ sentenceIndex: si, kind: "token", index: ti })}
                      onMouseLeave={() => clearIfSelf(si, "token", ti)}
                      className={outlined ? "rounded-lg ring-2 ring-sky-400" : undefined}
                    >
                      <Token
                        surface={token.surface}
                        reading={token.reading}
                        romaji={token.romaji}
                        gloss={token.gloss}
                        glossMode="hover"
                        particle={token.particle === true}
                        role={token.particle === true ? "particle" : "phrase"}
                        size="sm"
                        id={`text:${doc.id}:${si}:${ti}`}
                      />
                    </span>
                  );
                })}
              </div>

              {hasInvalid && <p className="text-xs text-amber-600">部分詞的讀音無法辨識，已略過標音與高亮</p>}

              <p className="text-xs text-stone-400">
                {sentence.tokens.map((t) => t.romaji).filter(Boolean).join(" ")}
              </p>

              <p className="flex flex-wrap gap-x-1 text-sm text-stone-600">
                {sentence.translation.map((chunk, ci) => {
                  const activeTokenIndex = activeTokenIndexFor(si);
                  const highlighted = activeTokenIndex !== null && chunk.token_indices.includes(activeTokenIndex);
                  return (
                    <span
                      key={ci}
                      onMouseEnter={() => setActive({ sentenceIndex: si, kind: "chunk", index: ci })}
                      onMouseLeave={() => clearIfSelf(si, "chunk", ci)}
                      onClick={() => setActive({ sentenceIndex: si, kind: "chunk", index: ci })}
                      className={`cursor-default rounded px-0.5 ${highlighted ? "bg-amber-100" : ""}`}
                    >
                      {chunk.text}
                    </span>
                  );
                })}
              </p>
            </div>
          );
        })}
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-stone-800">詞彙</h2>
          {doc.extracted.vocab.length === 0 ? (
            <p className="text-xs text-stone-400">無</p>
          ) : (
            doc.extracted.vocab.map((v, i) => {
              const added = isWordAdded(v);
              return (
                <div key={i} className="flex items-start justify-between gap-2 border-b border-stone-100 py-2 text-sm last:border-b-0">
                  <div>
                    <span className="font-medium text-stone-800">{v.surface}</span>{" "}
                    <span className="text-stone-400">{v.reading}</span>
                    <div className="text-xs text-stone-500">
                      {v.gloss} · {v.pos}
                    </div>
                    {v.note && <div className="text-xs text-stone-400">{v.note}</div>}
                  </div>
                  <button
                    type="button"
                    disabled={added}
                    onClick={() => void handleAddWord(v)}
                    className="shrink-0 rounded-lg border border-stone-200 px-2 py-1 text-xs text-stone-600 hover:bg-stone-50 disabled:cursor-default disabled:border-emerald-200 disabled:bg-emerald-50 disabled:text-emerald-600"
                  >
                    {added ? "已加入" : "加入我的單字"}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="space-y-2 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-stone-800">文法</h2>
          {doc.extracted.grammar.length === 0 ? (
            <p className="text-xs text-stone-400">無</p>
          ) : (
            doc.extracted.grammar.map((g, i) => (
              <button
                key={i}
                type="button"
                onClick={() => scrollToSentence(g.sentence_index)}
                className="block w-full border-b border-stone-100 py-2 text-left text-sm last:border-b-0 hover:bg-amber-50/60"
              >
                <span className="font-medium text-stone-800">{g.pattern}</span>
                <div className="text-xs text-stone-500">{g.explanation}</div>
              </button>
            ))
          )}
        </div>

        <div className="space-y-2 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-stone-800">助詞</h2>
          {doc.extracted.particles.length === 0 ? (
            <p className="text-xs text-stone-400">無</p>
          ) : (
            doc.extracted.particles.map((p, i) => (
              <button
                key={i}
                type="button"
                onClick={() => scrollToSentence(p.sentence_index)}
                className="block w-full border-b border-stone-100 py-2 text-left text-sm last:border-b-0 hover:bg-amber-50/60"
              >
                <span className="font-medium text-stone-800">{p.surface}</span>
                <div className="text-xs text-stone-500">{p.usage}</div>
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
