// Pure lookup helpers for the grammar pages (build task 2026-09 step 4:
// /grammar and /grammar/:particleId). Split out of index.ts the same way
// dates.ts is -- these all take `Bank` as a parameter rather than importing
// data/bank.json themselves, so they're unit-testable without the gitignored
// build artifact (see index.ts's and dates.ts's own header comments).

import type { Bank, ContrastSet, Particle, Sentence } from "./types.ts";

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
