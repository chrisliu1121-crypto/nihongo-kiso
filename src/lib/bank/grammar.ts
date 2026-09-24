// Pure lookup helpers for the grammar pages (build task 2026-09 step 4:
// /grammar and /grammar/:particleId). Split out of index.ts the same way
// dates.ts is -- these all take `Bank` as a parameter rather than importing
// data/bank.json themselves, so they're unit-testable without the gitignored
// build artifact (see index.ts's and dates.ts's own header comments).

import type { Bank, ContrastSet, GrammarCategory, GrammarItem, Particle, Sentence } from "./types.ts";

/** The sentence with this id, or undefined if it doesn't exist in the bank. */
export function getSentence(bank: Bank, id: string): Sentence | undefined {
  return bank.sentences.find((s) => s.id === id);
}

/** The particle with this id, or undefined if it isn't one of the 8. */
export function getParticle(bank: Bank, id: string): Particle | undefined {
  return bank.particles.particles.find((p) => p.id === id);
}

/** The contrast set with this id, or undefined if it doesn't exist. */
export function getContrastSet(bank: Bank, id: string): ContrastSet | undefined {
  return bank.particles.contrast_sets.find((cs) => cs.id === id);
}

/** Every contrast set that includes this particle id, in the order they're authored in data/particles.json. */
export function contrastSetsForParticle(bank: Bank, particleId: string): ContrastSet[] {
  return bank.particles.contrast_sets.filter((cs) => cs.particles.some((p) => p === particleId));
}

/**
 * The particle immediately before/after this one, in data/particles.json's
 * own authored order (DESIGN.md leaves prev/next ordering unspecified --
 * this build task uses the authoring order as the canonical sequence).
 * Either side is undefined at the ends of the list, or if `id` isn't found.
 */
export function adjacentParticles(
  bank: Bank,
  id: string,
): { prev: Particle | undefined; next: Particle | undefined } {
  const list = bank.particles.particles;
  const i = list.findIndex((p) => p.id === id);
  if (i === -1) return { prev: undefined, next: undefined };
  return { prev: list[i - 1], next: list[i + 1] };
}

// ---------------------------------------------------------------------------
// Generalized grammar-item helpers (build task 2026-09-24 §A/§D). These read
// bank.grammar (the ~30-item model), not bank.particles (kept above,
// untouched, purely for the pre-existing 8-particle/particle-swap-exercise
// back-compat consumers -- see types.ts's own header comment on why both
// exist side by side). GrammarItemPage/GrammarOverview use only these.

/** The grammar item with this id, or undefined if it doesn't exist. */
export function getGrammarItem(bank: Bank, id: string): GrammarItem | undefined {
  return bank.grammar.items.find((it) => it.id === id);
}

/** Every grammar item in this category, in data/grammar/items.json's own authored order. */
export function itemsByCategory(bank: Bank, category: GrammarCategory): GrammarItem[] {
  return bank.grammar.items.filter((it) => it.category === category);
}

/** The generalized contrast set with this id, or undefined if it doesn't exist (bank.grammar.contrasts, not bank.particles.contrast_sets). */
export function getGrammarContrastSet(bank: Bank, id: string): ContrastSet | undefined {
  return bank.grammar.contrasts.find((cs) => cs.id === id);
}

/** Every contrast set (from bank.grammar.contrasts) that includes this grammar item id. */
export function contrastSetsForItem(bank: Bank, itemId: string): ContrastSet[] {
  return bank.grammar.contrasts.filter((cs) => cs.particles.some((p) => p === itemId));
}

/**
 * The grammar item immediately before/after this one WITHIN ITS OWN
 * CATEGORY, in data/grammar/items.json's own authored order (same
 * "authoring order is canonical" choice adjacentParticles makes above, now
 * scoped to category since items.json interleaves categories far less
 * tightly than the old 8-particle list did).
 */
export function adjacentInCategory(
  bank: Bank,
  id: string,
): { prev: GrammarItem | undefined; next: GrammarItem | undefined } {
  const item = getGrammarItem(bank, id);
  if (!item) return { prev: undefined, next: undefined };
  const list = itemsByCategory(bank, item.category);
  const i = list.findIndex((it) => it.id === id);
  if (i === -1) return { prev: undefined, next: undefined };
  return { prev: list[i - 1], next: list[i + 1] };
}
