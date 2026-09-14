// scripts/lib/pending.ts — shared file-path/ctx plumbing for
// scripts/generate-daily.ts and scripts/cross-check.ts (build task 2026-09
// step 6). Neither script needs to know where data/pending or data/words
// physically live, or how to build a WordValidationCtx from the existing
// bank -- both just need "the day file for this date" and "what already
// exists elsewhere", so that logic lives here once.

import { access, readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DaySeed, PartOfSpeech, WordSeed } from "../../src/lib/bank/types.ts";
import type { JudgeResult } from "./ai/judge.ts";
import { buildKnownKanji, type RawDay, type WordValidationCtx } from "./validate-words.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..", "..");
export const WORDS_DIR = join(PROJECT_ROOT, "data", "words");
export const PENDING_DIR = join(PROJECT_ROOT, "data", "pending");
export const FREQUENCY_PATH = join(PROJECT_ROOT, "data", "frequency", "n5.json");

export function wordsPath(date: string): string {
  return join(WORDS_DIR, `${date}.json`);
}

export function pendingPath(date: string): string {
  return join(PENDING_DIR, `${date}.json`);
}

/** True iff `path` exists (any type, readable or not) -- used by generate-daily.ts's pre-flight checks (review items 1/2: never silently overwrite an already-promoted day or an already-generated pending file). */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * One word that failed an Enricher/Judge call with an AiProviderError
 * (code review item 1, P0) -- recorded instead of silently dropping the
 * whole day's batch. Carries every EnrichRequest field the word needs so a
 * later retry (scripts/cross-check.ts's `--enricher` retry pass) can
 * reconstruct the request without re-reading the frequency table.
 *
 * `stage` records which phase produced this failure ("enrich": the word
 * never made it into `PendingDayFile.words` at all, assembleSeed was never
 * reached; "judge": enrich() already succeeded and the word IS already
 * sitting in `words`, applyJudgments keeps every word so a failed/missing
 * judgment just leaves it `verified: false`) -- useful context for a human
 * reading a pending file, and for log messages.
 *
 * It is deliberately NOT the source of truth for whether
 * scripts/cross-check.ts's retry pass should re-enrich a given entry.
 * `stage` is optional, so a hand-edited or pre-this-field pending file may
 * not have it at all -- and "no `stage` on this entry" does NOT imply "this
 * was an enrich-stage failure"; it only means the entry predates this
 * field, which says nothing about which phase actually produced it. An
 * earlier version of this fix defaulted a missing `stage` to `"enrich"`,
 * which silently mis-handled an untagged judge-stage entry the same way
 * the original bug did (re-enriched and appended it, duplicating the
 * word). scripts/cross-check.ts now decides structurally instead: an
 * error's word id is looked up directly in `PendingDayFile.words` --
 * present means "already valid, leave it for the ordinary judge pass",
 * absent means "actually needs a fresh enrich() + append" -- a check that
 * can't be wrong the way trusting (or defaulting) `stage` can.
 */
export interface PipelineErrorEntry {
  id: string;
  surface: string;
  reading: string;
  gloss: string;
  pos: PartOfSpeech;
  level: string;
  freq_rank: number;
  /** AiProviderErrorKind, kept as `string` here so pending.ts doesn't need to import errors.ts just for a type. */
  kind: string;
  detail: string;
  stage?: "enrich" | "judge";
}

/** Per-word pipeline bookkeeping recorded alongside a pending day (DESIGN.md §9.1). */
export interface PipelineMeta {
  enricher: string;
  judge: string;
  generated_at: string;
  /** word id -> the judge's verdict for it (empty until the judge step has run). */
  judgments: Record<string, JudgeResult>;
  /**
   * Words whose enrich() call failed with an AiProviderError (code review
   * item 1, P0) and so never made it into `words` above. Optional so old
   * pending files written before this field existed still parse; always
   * populated (possibly `[]`) by every writer added after this change.
   * Non-empty means the day is incomplete -- scripts/cross-check.ts retries
   * exactly these words before doing anything else, and promotion refuses
   * while this is non-empty.
   */
  errors?: PipelineErrorEntry[];
}

/** Shape of one data/pending/YYYY-MM-DD.json file: a DaySeed (same shape as data/words/*.json) plus pipeline metadata build-bank.ts never reads (build-bank does not read data/pending/ at all -- DESIGN.md §12 step 6). */
export interface PendingDayFile extends DaySeed {
  pipeline: PipelineMeta;
}

/** Read every data/words/*.json file, tagged with its own filename (same RawDay shape validate-words.ts/build-bank.ts already use). */
export async function loadExistingWordDays(): Promise<RawDay[]> {
  let filenames: string[];
  try {
    filenames = (await readdir(WORDS_DIR)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const out: RawDay[] = [];
  for (const filename of filenames) {
    const raw = await readFile(join(WORDS_DIR, filename), "utf8");
    out.push({ file: filename, seed: JSON.parse(raw) as DaySeed });
  }
  return out;
}

/** Every WordSeed across every existing data/words/*.json day, flattened (order-preserving: earliest day first). */
export function flattenWords(days: RawDay[]): WordSeed[] {
  return days.flatMap((d) => d.seed.words);
}

/**
 * Build the WordValidationCtx validateWordFile needs from the existing
 * bank: every id/surface+reading/freq_rank already used anywhere, the
 * confusable_with list for the one-directional check validateWordFile can
 * do, the in-scope kanji set (frequency table surfaces + every existing
 * word's own surface -- review item 5(a)), and every existing example.ja
 * mapped to its owner id (review item 5(b): example sentences must be
 * unique bank-wide). `freqSurfaces` is passed in rather than read from disk
 * here so this stays a pure function of its inputs -- callers (generate-daily.ts,
 * cross-check.ts) already have the frequency table loaded for word
 * selection anyway.
 */
export function buildWordCtx(existingDays: RawDay[], freqSurfaces: Iterable<string>): WordValidationCtx {
  const words = flattenWords(existingDays);
  return {
    existingIds: new Set(words.map((w) => w.id)),
    existingSurfaceReading: new Set(words.map((w) => `${w.surface}|${w.reading}`)),
    existingFreqRanks: new Set(words.map((w) => w.freq_rank)),
    existingConfusableWith: new Map(words.map((w) => [w.id, w.confusable_with])),
    knownKanji: buildKnownKanji([...freqSurfaces, ...words.map((w) => w.surface)]),
    existingExampleJa: new Map(words.map((w) => [w.example.ja, w.id])),
  };
}

/**
 * Next `count` ids continuing from the highest "w_NNNN" id anywhere in the
 * existing bank (w_0001-style, at least 4 digits, zero-padded to 4).
 *
 * Deliberately does NOT backfill gaps (e.g. if w_0007 was ever deleted, the
 * next batch still starts at max+1, not at 0007): DESIGN.md §8.6 says
 * plainly that word/cell ids "一旦發佈就不能改" -- everything downstream
 * (localStorage progress records, future SRS scheduling, confusable_with
 * references, error logs) keys off the id string, permanently. Reusing a
 * freed id would let a NEW word silently inherit an OLD word's history the
 * moment anyone's browser still has stale state referencing it -- a
 * correctness bug that's invisible until it corrupts someone's progress.
 * "Continue from the max" is the only rule that can never collide with
 * anything that has ever existed.
 */
export function nextWordIds(existingDays: RawDay[], count: number): string[] {
  let maxN = 0;
  for (const w of flattenWords(existingDays)) {
    const m = /^w_(\d+)$/.exec(w.id);
    if (m) maxN = Math.max(maxN, Number(m[1]));
  }
  return Array.from({ length: count }, (_, i) => `w_${String(maxN + 1 + i).padStart(4, "0")}`);
}

/** Every surface used anywhere in any existing word's example.tokens -- fed to an Enricher as `existing_surfaces` so it can avoid near-duplicate examples (build task 2026-09 step 6, EnrichRequest.existing_surfaces). */
export function collectExistingExampleSurfaces(existingDays: RawDay[]): string[] {
  const set = new Set<string>();
  for (const w of flattenWords(existingDays)) {
    for (const t of w.example.tokens) set.add(t.surface);
  }
  return [...set];
}

/** Every existing word's full example.ja sentence -- fed to a Judge as `existing_examples` so it can flag a candidate that reads as a near-duplicate of one already in the bank (review item 9). Distinct from collectExistingExampleSurfaces above: that one is per-token surfaces (for an Enricher deciding what NOT to write yet); this is whole sentences (for a Judge deciding whether what WAS written is too similar to something already published). */
export function collectExistingExampleJa(existingDays: RawDay[]): string[] {
  return flattenWords(existingDays).map((w) => w.example.ja);
}

/** basename(file, ".json") -- kept as a tiny wrapper so callers don't need their own node:path import just for this. */
export function dateFromFilename(file: string): string {
  return basename(file, ".json");
}
