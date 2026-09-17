// scripts/lib/ai/file.ts — Enricher/Judge backed by a pre-recorded JSON file
// (build task 2026-09 step 6). Stands in for "what an AI would have said"
// in tests, without touching the network or needing a key: keyed by
// `${surface}|${reading}`, same join key validate-words.ts uses everywhere
// else in this codebase for "which word is this". Also the vehicle for
// deliberately-bad fixtures (a reading that sneaks in kanji, a particle
// token missing `particle: true`, a `ja` that doesn't match its tokens) so
// generate-daily's validate step can be tested against realistic AI
// mistakes without a live model.

import { readFile } from "node:fs/promises";
import type { Enricher, EnrichRequest, EnrichResult } from "./enricher.ts";
import type { Judge, JudgeRequest, JudgeResult } from "./judge.ts";
import { AiProviderError } from "./errors.ts";

function wordKey(surface: string, reading: string): string {
  return `${surface}|${reading}`;
}

/** Loads `path` (JSON object keyed by "surface|reading") lazily, once, and caches the parsed object for every subsequent lookup call. */
function makeLoader<T>(path: string): () => Promise<Record<string, T>> {
  let cached: Promise<Record<string, T>> | null = null;
  return () => {
    if (!cached) {
      cached = readFile(path, "utf8").then((raw) => JSON.parse(raw) as Record<string, T>);
    }
    return cached;
  };
}

/**
 * 2026-09-17 "卡死" fix (DESIGN.md §9.1 "逐詞重試與替補"): a fixture entry
 * can now be EITHER a single result (unchanged, back-compat) OR an array of
 * results consumed one per call -- call N (1-indexed) gets `arr[N-1]`; once
 * N exceeds the array's length, every further call keeps getting the LAST
 * element. This is what lets a test fixture simulate "this word's first
 * attempt is bad, its second attempt is good" offline, entirely through the
 * fixture file's own data instead of custom test-only Enricher/Judge
 * objects.
 */
function pickByCallCount<T>(entry: T | T[], callIndex: number): T {
  if (!Array.isArray(entry)) return entry;
  const idx = Math.min(callIndex, entry.length - 1);
  return entry[idx];
}

/**
 * Enricher whose answers come from a pre-recorded JSON file at `path`
 * (object keyed by "surface|reading" -> EnrichResult, or -> EnrichResult[]
 * for a per-attempt sequence -- see pickByCallCount above). Throws if a
 * requested word isn't in the file -- silently falling back to some default
 * would defeat the point of a fixture file (a test that thinks it's
 * checking FileEnricher's output would actually be checking the fallback).
 *
 * Throws AiProviderError (kind "schema" -- "no valid recorded result for
 * this word", the closest fit among the closed set of kinds) rather than a
 * plain Error: this doubles as this codebase's offline stand-in for a real
 * provider's per-word failure (code review item 1's "FileEnricher's
 * existing 'throws if word not found' behavior... makes the test fully
 * offline, no fetch mocking needed"), so it needs to be catchable the same
 * way an openrouter.ts/claude.ts per-word failure is by generate-daily.ts's
 * enrich loop.
 */
export function FileEnricher(path: string): Enricher {
  const load = makeLoader<EnrichResult | EnrichResult[]>(path);
  const callCounts = new Map<string, number>();
  return {
    name: `file:${path}`,
    async enrich(req: EnrichRequest): Promise<EnrichResult> {
      const table = await load();
      const key = wordKey(req.surface, req.reading);
      const entry = table[key];
      if (!entry) {
        throw new AiProviderError(`file:${path}`, "schema", `FileEnricher(${path})：找不到 "${key}" 的預錄結果`);
      }
      const callIndex = callCounts.get(key) ?? 0;
      callCounts.set(key, callIndex + 1);
      return pickByCallCount(entry, callIndex);
    },
  };
}

/**
 * Judge whose answers come from a pre-recorded JSON file at `path` (object
 * keyed by "surface|reading" -> JudgeResult, or -> JudgeResult[] for a
 * per-attempt sequence -- same pickByCallCount treatment as FileEnricher
 * above). Throws AiProviderError if a requested word isn't in the file, for
 * the same reason FileEnricher does.
 */
export function FileJudge(path: string): Judge {
  const load = makeLoader<JudgeResult | JudgeResult[]>(path);
  const callCounts = new Map<string, number>();
  return {
    name: `file:${path}`,
    async judge(req: JudgeRequest): Promise<JudgeResult> {
      const table = await load();
      const key = wordKey(req.surface, req.reading);
      const entry = table[key];
      if (!entry) {
        throw new AiProviderError(`file:${path}`, "schema", `FileJudge(${path})：找不到 "${key}" 的預錄結果`);
      }
      const callIndex = callCounts.get(key) ?? 0;
      callCounts.set(key, callIndex + 1);
      return pickByCallCount(entry, callIndex);
    },
  };
}
