// ParticlePage — "/grammar/:particleId": single-particle detail page
// (build task 2026-09 step 4, DESIGN.md §8.4). An unknown id renders the
// same NotFound content as the `*` route.

import { Link, useParams } from "react-router-dom";
import { Token } from "../components/Token";
import { SentenceLine } from "../components/SentenceLine";
import { ContrastSetView } from "../components/ContrastSetView";
import type { ContrastSetPair } from "../components/ContrastSetView";
import { NotFound } from "./NotFound";
import bank, { adjacentParticles, contrastSetsForParticle, getParticle, getSentence } from "../lib/bank";
import type { ContrastSet, ParticleClass } from "../lib/bank";

const CLASS_LABEL: Record<ParticleClass, string> = {
  kaku: "格助詞",
  kakari: "係助詞",
  rentai: "連體助詞",
};

const CLASS_DESCRIPTION: Record<ParticleClass, string> = {
  kaku: "標記名詞在句中扮演的角色",
  kakari: "標記這句話在談什麼（與角色是兩回事）",
  rentai: "連接名詞與名詞",
};

function resolvePairs(cs: ContrastSet): ContrastSetPair[] {
  return cs.pairs.map((p) => {
    const sentence = getSentence(bank, p.sentence_id);
    if (!sentence) {
      throw new Error(`ParticlePage: contrast set ${cs.id} references missing sentence ${p.sentence_id}`);
    }
    return { sentence, note: p.note };
  });
}

export function ParticlePage() {
  const { particleId } = useParams<{ particleId: string }>();
  const particle = particleId ? getParticle(bank, particleId) : undefined;

  if (!particle) {
    return <NotFound />;
  }

  const { prev, next } = adjacentParticles(bank, particle.id);
  const relatedSets = contrastSetsForParticle(bank, particle.id);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <Token
          surface={particle.surface}
          reading={particle.reading}
          romaji={particle.romaji}
          role="particle"
          particle
          interactive={false}
          size="lg"
        />
        <div>
          {particle.romaji_note && <p className="text-sm text-stone-500">{particle.romaji_note}</p>}
          <span className="mt-1 inline-block rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
            {CLASS_LABEL[particle.class]}
          </span>
          <p className="mt-1 text-xs text-stone-400">{CLASS_DESCRIPTION[particle.class]}</p>
        </div>
      </div>

      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <p className="text-base font-medium text-stone-800">{particle.core}</p>
        <p className="mt-1 text-sm text-stone-500">{particle.zh_bridge}</p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-stone-800">用法</h2>
        <div className="mt-3 space-y-3">
          {particle.senses.map((sense) => {
            const sentence = getSentence(bank, sense.example_id);
            if (!sentence) return null;
            return (
              <div key={sense.label} className="rounded-lg border border-stone-100 bg-stone-50 p-3">
                <p className="mb-1 text-xs font-medium text-amber-700">{sense.label}</p>
                <SentenceLine sentence={sentence} />
              </div>
            );
          })}
        </div>
      </section>

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
          回助詞總覽
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
