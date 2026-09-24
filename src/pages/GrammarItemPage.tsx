// GrammarItemPage — "/grammar/:id": single grammar-item detail page (build
// task 2026-09-24 §D). Generalizes ParticlePage (build task 2026-09 step 4,
// DESIGN.md §8.4) from the fixed 8-particle model to bank.grammar.items --
// same route pattern (`/grammar/:id`, param renamed from :particleId to
// :id in App.tsx), so every pre-existing URL like `/grammar/wa` still
// resolves, now through this page instead of ParticlePage (deleted). An
// unknown id renders the same NotFound content as the `*` route.

import { Link, useParams } from "react-router-dom";
import { Token } from "../components/Token";
import { SentenceLine } from "../components/SentenceLine";
import { ContrastSetView } from "../components/ContrastSetView";
import type { ContrastSetPair } from "../components/ContrastSetView";
import { NotFound } from "./NotFound";
import { readingToRomaji } from "../lib/kana";
import bank, {
  adjacentInCategory,
  contrastSetsForItem,
  getGrammarItem,
  getSentence,
} from "../lib/bank";
import type { ContrastSet } from "../lib/bank";
import { GrammarJumpSelect } from "../components/GrammarPicker";
import { CATEGORY_DESCRIPTION, CATEGORY_LABEL } from "../lib/grammar/categories";

function resolvePairs(cs: ContrastSet): ContrastSetPair[] {
  return cs.pairs.map((p) => {
    const sentence = getSentence(bank, p.sentence_id);
    if (!sentence) {
      throw new Error(`GrammarItemPage: contrast set ${cs.id} references missing sentence ${p.sentence_id}`);
    }
    return { sentence, note: p.note };
  });
}

export function GrammarItemPage() {
  const { id } = useParams<{ id: string }>();
  const item = id ? getGrammarItem(bank, id) : undefined;

  if (!item) {
    return <NotFound />;
  }

  // GrammarItem has no stored romaji (build task 2026-09-24 §A: it's
  // recomputed, never authored -- see build-bank.ts's deriveParticlesFile
  // for the same reasoning applied to the back-compat Particle view).
  // `particle: !!item.cell` mirrors GrammarOverview's card: only a
  // single-mora particle (has a `cell`) gets the は/へ→wa/e override.
  const romaji = readingToRomaji(item.reading, { particle: !!item.cell }).romaji;
  const { prev, next } = adjacentInCategory(bank, item.id);
  const relatedSets = contrastSetsForItem(bank, item.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Link to="/grammar" className="text-sm text-stone-500 hover:text-amber-700 hover:underline">
          ← 文法總覽
        </Link>
        <GrammarJumpSelect currentId={item.id} />
      </div>

      <div className="flex items-start gap-4">
        <Token
          surface={item.surface}
          reading={item.reading}
          romaji={romaji}
          role={item.cell ? "particle" : "phrase"}
          particle={!!item.cell}
          interactive={false}
          size="lg"
        />
        <div>
          <span className="inline-block rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
            {CATEGORY_LABEL[item.category]}
          </span>
          <p className="mt-1 text-xs text-stone-400">{CATEGORY_DESCRIPTION[item.category]}</p>
          {item.pattern && <p className="mt-1 text-sm text-stone-500">接續：{item.pattern}</p>}
        </div>
      </div>

      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <p className="text-base font-medium text-stone-800">{item.core}</p>
        {item.zh_bridge && <p className="mt-1 text-sm text-stone-500">{item.zh_bridge}</p>}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-stone-800">用法</h2>
        <div className="mt-3 space-y-3">
          {item.senses.map((sense) => (
            <div key={sense.label} className="rounded-lg border border-stone-100 bg-stone-50 p-3">
              <p className="text-xs font-medium text-amber-700">{sense.label}</p>
              <p className="mt-0.5 mb-2 text-sm text-stone-600">{sense.explanation}</p>
              <div className="space-y-2">
                {sense.example_ids.map((exampleId) => {
                  const sentence = getSentence(bank, exampleId);
                  if (!sentence) return null;
                  return <SentenceLine key={exampleId} sentence={sentence} />;
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {item.notes && item.notes.length > 0 && (
        <section className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4">
          <h2 className="text-sm font-semibold text-stone-700">易錯點</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-stone-600">
            {item.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      )}

      {relatedSets.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-stone-800">相關對照</h2>
          {relatedSets.map((cs) => (
            <ContrastSetView key={cs.id} contrastSet={cs} pairs={resolvePairs(cs)} />
          ))}
        </section>
      )}

      <nav className="flex items-center justify-between border-t border-dashed border-stone-200 pt-4 text-sm">
        {prev ? (
          <Link to={`/grammar/${prev.id}`} className="text-amber-700 hover:underline">
            ← {prev.surface}
          </Link>
        ) : (
          <span />
        )}
        <Link to="/grammar" className="text-stone-500 hover:underline">
          回文法總覽
        </Link>
        {next ? (
          <Link to={`/grammar/${next.id}`} className="text-amber-700 hover:underline">
            {next.surface} →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}
