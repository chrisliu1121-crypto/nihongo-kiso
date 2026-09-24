// src/lib/reader/analyze.ts — turns pasted Japanese text into a TextDoc:
// segments the input, sends each segment to OpenRouter (via
// src/lib/ai/openrouterBrowser.ts), validates each response, computes
// romaji locally (never trusts the AI for it -- DESIGN.md-style rule
// mirrored from scripts/lib/validate-words.ts: kana -> romaji is always a
// deterministic local computation, not a model output), and merges every
// segment's sentences/extracted vocab into one TextDoc.
//
// P1 review fix ("多段分析中途失敗／離開 → 已付費的段落白費"): a multi-segment
// document used to only get written to storage once EVERY segment had
// succeeded -- a failure (or the user closing the tab) on segment 3 of 5
// threw away 2 segments' worth of already-paid-for OpenRouter output.
// processSegments() below now persists the TextDoc after each individual
// segment succeeds (via `onSegmentSaved`), so the caller's store always
// has whatever's been analyzed so far, tagged `status: "partial"` with the
// remaining segments in `pendingSegments`. analyzeText() (fresh) and
// continueAnalysis() (resume a partial doc) both go through it.
//
// Every step here is pure/injectable (fetchImpl, sleep) so analyze.test.ts
// can run this whole pipeline against a fake fetch with no real network.

import { KanaInputError } from "../kana/types.ts";
import { readingToRomaji } from "../kana/index.ts";
import {
  callOpenRouterChat,
  stripFence,
  type ChatRequestBody,
  type FetchLike,
  type SleepLike,
} from "../ai/openrouterBrowser.ts";
import { ANALYSIS_JSON_SCHEMA, ANALYSIS_SYSTEM_PROMPT, AnalysisResponseSchema, type RawSentence } from "./aiSchema.ts";
import type {
  Extracted,
  ExtractedGrammar,
  ExtractedParticle,
  ExtractedVocab,
  ReaderSentence,
  ReaderToken,
  TextDoc,
  TranslationChunk,
} from "./types.ts";

/** Hard cap on pasted input length -- enforced by the /texts/new page before analyzeText is ever called, and re-checked here as a safety net. */
export const MAX_INPUT_LENGTH = 4000;
/** Target max length of one OpenRouter request's text -- segmentText never SPLITS a sentence to stay under this, so a single very long sentence still becomes its own (over-length) segment. */
export const MAX_SEGMENT_LENGTH = 800;

const MAX_TOKENS = 8192;

const MAX_VOCAB = 12;
const MAX_GRAMMAR = 6;
const MAX_PARTICLES = 8;

// ---------------------------------------------------------------------------
// Segmentation (pure, unit-testable without any network).

interface Unit {
  /** Index of the source line this unit came from -- used only to decide whether a "\n" separator belongs between two units when they're joined into one segment (preserves line structure for lyrics, per the system prompt's "每一行視為一句"). */
  line: number;
  text: string;
}

/** Split `text` into line-scoped sentence units: split on newlines first, then (within a line) split right after each "。" so multiple sentences on one line become separate units. Blank lines are dropped (they carry no content to segment, and would otherwise force a segment break with nothing on either side). */
function splitIntoUnits(text: string): Unit[] {
  const lines = text.split(/\r?\n/);
  const units: Unit[] = [];
  lines.forEach((line, lineIndex) => {
    if (line.trim() === "") return;
    const parts = line.split(/(?<=。)/).filter((p) => p !== "");
    for (const part of parts) units.push({ line: lineIndex, text: part });
  });
  return units;
}

/**
 * Group `text` into segments of at most `maxLen` characters each, never
 * splitting a sentence unit (splitIntoUnits's own granularity) across two
 * segments -- a single unit longer than maxLen becomes its own (over-length)
 * segment rather than being cut mid-sentence. Units from different source
 * lines are joined with "\n" (line structure preserved for the prompt);
 * units from the same line (split only by "。") are concatenated directly.
 */
export function segmentText(text: string, maxLen: number = MAX_SEGMENT_LENGTH): string[] {
  const units = splitIntoUnits(text);
  const segments: string[] = [];
  let current = "";
  let currentLine = -1;

  for (const unit of units) {
    if (current === "") {
      current = unit.text;
      currentLine = unit.line;
      continue;
    }
    const sep = unit.line !== currentLine ? "\n" : "";
    const candidate = current + sep + unit.text;
    if (candidate.length > maxLen) {
      segments.push(current);
      current = unit.text;
    } else {
      current = candidate;
    }
    currentLine = unit.line;
  }
  if (current !== "") segments.push(current);
  return segments;
}

// ---------------------------------------------------------------------------
// Request building.

export function buildAnalysisRequestBody(segment: string, model: string): ChatRequestBody {
  return {
    model,
    messages: [
      { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({ text: segment }) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "reader_analysis", strict: true, schema: ANALYSIS_JSON_SCHEMA },
    },
    temperature: 0,
    max_tokens: MAX_TOKENS,
  };
}

// ---------------------------------------------------------------------------
// Local romaji computation -- never trust the model for this (see file
// header). A token whose reading can't be converted (kanji leaked into
// reading, stray romaji, etc.) is marked `invalid` and kept as plain text;
// it must never take down the rest of the sentence/document.

/** readingToRomaji, tolerant of a reading kanaToCells can't handle -- returns "" instead of throwing. Exported for reuse by pages that compute a MyWord's romaji at "加入我的單字" time. */
export function safeRomaji(reading: string, opts?: { particle?: boolean }): { romaji: string; invalid: boolean } {
  if (reading === "") return { romaji: "", invalid: false };
  try {
    return { romaji: readingToRomaji(reading, opts).romaji, invalid: false };
  } catch (err) {
    if (err instanceof KanaInputError) return { romaji: "", invalid: true };
    throw err;
  }
}

function buildToken(raw: RawSentence["tokens"][number]): ReaderToken {
  const { romaji, invalid } = safeRomaji(raw.reading, { particle: raw.particle === true });
  return {
    surface: raw.surface,
    reading: raw.reading,
    gloss: raw.gloss,
    particle: raw.particle,
    romaji,
    invalid,
  };
}

function dedupeIndices(indices: number[]): number[] {
  return [...new Set(indices)];
}

function buildSentence(raw: RawSentence): ReaderSentence {
  const tokens = raw.tokens.map(buildToken);
  const translation: TranslationChunk[] = raw.translation.map((chunk) => ({
    text: chunk.text,
    // Out-of-range / duplicate token_indices are dropped here (never thrown
    // over) so one bad index in one translation fragment can't take down
    // the whole document -- the fragment's text is still kept, it just
    // aligns to fewer (or zero) tokens.
    token_indices: dedupeIndices(chunk.token_indices).filter((i) => i >= 0 && i < tokens.length),
  }));
  return { tokens, translation };
}

// ---------------------------------------------------------------------------
// Extracted vocab/grammar/particles: merged across every segment's response,
// then deduped and capped to the limits the system prompt already asks each
// individual segment to respect (a multi-segment document can still exceed
// them in aggregate).

/** Clamp `index` into [0, maxIndex] (maxIndex may be -1 when there are no sentences at all yet, in which case every index clamps to 0 -- shouldn't happen in practice since a segment producing extracted.grammar/particles also produces at least one sentence, but never index out of an empty array either way). P2 review fix companion to aiSchema.ts's `.min(0)`: the schema already rejects a NEGATIVE sentence_index outright (OpenRouter would have to violate strict-mode json_schema to produce one), but nothing stopped an in-range-but-stale index from a differently-sized segment, or arithmetic here, from pointing past the end of `sentences` -- clamping here is the actual enforcement of "always a valid index into this doc's sentences". */
function clampSentenceIndex(index: number, maxIndex: number): number {
  if (maxIndex < 0) return 0;
  return Math.min(Math.max(index, 0), maxIndex);
}

function dedupeExtracted(extracted: Extracted): Extracted {
  const vocabSeen = new Set<string>();
  const vocab: ExtractedVocab[] = [];
  for (const v of extracted.vocab) {
    const key = `${v.surface}|${v.reading}`;
    if (vocabSeen.has(key)) continue;
    vocabSeen.add(key);
    vocab.push(v);
    if (vocab.length >= MAX_VOCAB) break;
  }

  const grammarSeen = new Set<string>();
  const grammar: ExtractedGrammar[] = [];
  for (const g of extracted.grammar) {
    if (grammarSeen.has(g.pattern)) continue;
    grammarSeen.add(g.pattern);
    grammar.push(g);
    if (grammar.length >= MAX_GRAMMAR) break;
  }

  const particlesSeen = new Set<string>();
  const particles: ExtractedParticle[] = [];
  for (const p of extracted.particles) {
    if (particlesSeen.has(`${p.surface}|${p.usage}`)) continue;
    particlesSeen.add(`${p.surface}|${p.usage}`);
    particles.push(p);
    if (particles.length >= MAX_PARTICLES) break;
  }

  return { vocab, grammar, particles };
}

/** Merge one segment's freshly-validated `incoming` extracted data into `existing` (already deduped/capped from prior segments): rebase its sentence_index fields by `offset` (how many sentences existed before this segment) and clamp into this doc's now-final sentence count, then re-run the same dedupe+cap pass over the combined list (existing entries keep priority on a tie, since they're listed first). */
function mergeExtracted(existing: Extracted, incoming: Extracted, offset: number, totalSentences: number): Extracted {
  const maxIndex = totalSentences - 1;
  return dedupeExtracted({
    vocab: [...existing.vocab, ...incoming.vocab],
    grammar: [
      ...existing.grammar,
      ...incoming.grammar.map((g) => ({ ...g, sentence_index: clampSentenceIndex(g.sentence_index + offset, maxIndex) })),
    ],
    particles: [
      ...existing.particles,
      ...incoming.particles.map((p) => ({ ...p, sentence_index: clampSentenceIndex(p.sentence_index + offset, maxIndex) })),
    ],
  });
}

// ---------------------------------------------------------------------------
// Title / id.

/** Default title: first 20 chars of the first non-blank line. */
export function deriveTitle(source: string): string {
  const firstLine = source.split(/\r?\n/).find((line) => line.trim() !== "") ?? "";
  const title = firstLine.trim().slice(0, 20);
  return title || "未命名文本";
}

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `text_${crypto.randomUUID()}`;
  }
  return `text_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Main entry points.

export interface AnalyzeOptions {
  apiKey: string;
  model: string;
  fetchImpl?: FetchLike;
  sleep?: SleepLike;
  /** Called before each remaining segment's request is sent, 0-based `done` (segments completed so far IN THIS CALL) out of `total` (segments remaining IN THIS CALL -- not the whole document, so a "繼續分析" resume starts its own progress back at 0/n). Also called once with done === total after the last segment finishes. */
  onProgress?: (done: number, total: number) => void;
  /**
   * Called synchronously after EACH segment succeeds, with the TextDoc as it
   * stands right then (status "partial" unless this was the doc's last
   * pending segment). Callers persist this (store.putText) so a mid-run
   * failure or page reload never loses an already-analyzed segment -- see
   * this file's header. Awaited before the next segment is requested, so a
   * caller that also updates on-screen state can rely on the store already
   * reflecting this segment by the time the next `onProgress` fires.
   */
  onSegmentSaved?: (doc: TextDoc) => void | Promise<void>;
}

/** Runs `doc.pendingSegments` through OpenRouter one at a time, appending each success onto `doc.sentences`/`doc.extracted` and shrinking `pendingSegments`, persisting via `opts.onSegmentSaved` after every success. Shared core for analyzeText (fresh, pendingSegments === the whole document) and continueAnalysis (resume, pendingSegments === whatever didn't finish last time). Throws on the first failing segment; whatever succeeded before that is already both returned-so-far-reflected in `doc` state AND (via onSegmentSaved) already persisted by the caller -- the exception itself carries no partial doc, callers that need it read it back from their own store. */
async function processSegments(doc: TextDoc, opts: AnalyzeOptions): Promise<TextDoc> {
  let current = doc;
  const total = current.pendingSegments.length;

  for (let i = 0; i < total; i++) {
    opts.onProgress?.(i, total);

    const segment = current.pendingSegments[0];
    const body = buildAnalysisRequestBody(segment, opts.model);
    const completion = await callOpenRouterChat({
      apiKey: opts.apiKey,
      body,
      fetchImpl: opts.fetchImpl,
      sleep: opts.sleep,
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFence(completion.content));
    } catch (err) {
      throw new Error(`OpenRouter 回應不是合法 JSON：${err instanceof Error ? err.message : String(err)}`);
    }

    const result = AnalysisResponseSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`OpenRouter 回傳的內容不符合預期格式：${result.error.message}`);
    }

    const offset = current.sentences.length;
    const newSentences = result.data.sentences.map(buildSentence);
    const sentences = [...current.sentences, ...newSentences];
    const pendingSegments = current.pendingSegments.slice(1);

    current = {
      ...current,
      sentences,
      extracted: mergeExtracted(current.extracted, result.data.extracted, offset, sentences.length),
      pendingSegments,
      status: pendingSegments.length === 0 ? "complete" : "partial",
      updatedAt: new Date().toISOString(),
    };

    await opts.onSegmentSaved?.(current);
  }

  opts.onProgress?.(total, total);
  return current;
}

/**
 * Analyze `sourceText` end to end, from scratch: segment -> one OpenRouter
 * request per segment (sequential, persisted incrementally -- see
 * processSegments) -> validate -> locally compute romaji/invalid -> merge
 * into one TextDoc. Throws OpenRouterBrowserError (network/auth/quota/...)
 * or a plain Error (bad input length, schema mismatch) if any segment
 * fails; everything that succeeded BEFORE the failing segment is already
 * persisted (via opts.onSegmentSaved) as a `status: "partial"` doc -- the
 * caller should read it back from its store (by the id it saw in its own
 * onSegmentSaved calls) rather than treat the whole analysis as having left
 * nothing behind. Resume the rest later with continueAnalysis().
 */
export async function analyzeText(sourceText: string, opts: AnalyzeOptions): Promise<TextDoc> {
  if (sourceText.length === 0) {
    throw new Error("請先貼上文字");
  }
  if (sourceText.length > MAX_INPUT_LENGTH) {
    throw new Error(`輸入超過上限（${MAX_INPUT_LENGTH} 字），目前 ${sourceText.length} 字，請縮短後再試`);
  }

  const segments = segmentText(sourceText, MAX_SEGMENT_LENGTH);
  const now = new Date().toISOString();
  const initialDoc: TextDoc = {
    id: generateId(),
    title: deriveTitle(sourceText),
    createdAt: now,
    updatedAt: now,
    source: sourceText,
    model: opts.model,
    sentences: [],
    extracted: { vocab: [], grammar: [], particles: [] },
    status: segments.length === 0 ? "complete" : "partial",
    pendingSegments: segments,
  };

  return processSegments(initialDoc, opts);
}

/**
 * Resume a `status: "partial"` TextDoc: processes exactly `doc.pendingSegments`
 * (the original text segments that didn't finish before), appending onto
 * its existing `sentences`/`extracted` with sentence_index offsets
 * continuing from where it left off -- the result is indistinguishable from
 * having analyzed the whole document in one run (same sentence order, same
 * offsets). A no-op (returns `doc` unchanged, no network call) when there's
 * nothing pending.
 */
export async function continueAnalysis(doc: TextDoc, opts: AnalyzeOptions): Promise<TextDoc> {
  if (doc.status === "complete" || doc.pendingSegments.length === 0) return doc;
  return processSegments(doc, opts);
}
