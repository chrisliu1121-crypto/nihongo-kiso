// src/lib/reader/analyze.ts — turns pasted Japanese text into a TextDoc:
// segments the input, sends each segment to OpenRouter (via
// src/lib/ai/openrouterBrowser.ts), validates each response, computes
// romaji locally (never trusts the AI for it -- DESIGN.md-style rule
// mirrored from scripts/lib/validate-words.ts: kana -> romaji is always a
// deterministic local computation, not a model output), and merges every
// segment's sentences/extracted vocab into one TextDoc.
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
    const key = `${p.surface}|${p.usage}`;
    if (particlesSeen.has(key)) continue;
    particlesSeen.add(key);
    particles.push(p);
    if (particles.length >= MAX_PARTICLES) break;
  }

  return { vocab, grammar, particles };
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
// Main entry point.

export interface AnalyzeOptions {
  apiKey: string;
  model: string;
  fetchImpl?: FetchLike;
  sleep?: SleepLike;
  /** Called before each segment's request is sent, 0-based `done` (segments completed so far) out of `total`. Also called once with done === total after the last segment finishes. */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Analyze `sourceText` end to end: segment -> one OpenRouter request per
 * segment (sequential, so onProgress reports real progress) -> validate ->
 * locally compute romaji/invalid -> merge into one TextDoc. Throws
 * OpenRouterBrowserError (network/auth/quota/...) or a plain Error (bad
 * input length, schema mismatch) on failure; never returns a partial
 * TextDoc -- a failed segment fails the whole analysis (the caller can
 * retry the same call, OpenRouter is not charged for the JSON that already
 * came back but doesn't leave localStorage/IndexedDB either way).
 */
export async function analyzeText(sourceText: string, opts: AnalyzeOptions): Promise<TextDoc> {
  if (sourceText.length === 0) {
    throw new Error("請先貼上文字");
  }
  if (sourceText.length > MAX_INPUT_LENGTH) {
    throw new Error(`輸入超過上限（${MAX_INPUT_LENGTH} 字），目前 ${sourceText.length} 字，請縮短後再試`);
  }

  const segments = segmentText(sourceText, MAX_SEGMENT_LENGTH);
  const total = segments.length;

  const rawSentences: RawSentence[] = [];
  const extracted: Extracted = { vocab: [], grammar: [], particles: [] };

  for (let i = 0; i < total; i++) {
    opts.onProgress?.(i, total);

    const body = buildAnalysisRequestBody(segments[i], opts.model);
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

    const offset = rawSentences.length;
    rawSentences.push(...result.data.sentences);
    extracted.vocab.push(...result.data.extracted.vocab);
    extracted.grammar.push(
      ...result.data.extracted.grammar.map((g) => ({ ...g, sentence_index: g.sentence_index + offset })),
    );
    extracted.particles.push(
      ...result.data.extracted.particles.map((p) => ({ ...p, sentence_index: p.sentence_index + offset })),
    );
  }

  opts.onProgress?.(total, total);

  const sentences = rawSentences.map(buildSentence);
  const now = new Date().toISOString();

  return {
    id: generateId(),
    title: deriveTitle(sourceText),
    createdAt: now,
    updatedAt: now,
    source: sourceText,
    model: opts.model,
    sentences,
    extracted: dedupeExtracted(extracted),
  };
}
