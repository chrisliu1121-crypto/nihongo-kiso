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
 * Enricher whose answers come from a pre-recorded JSON file at `path`
 * (object keyed by "surface|reading" -> EnrichResult). Throws if a
 * requested word isn't in the file -- silently falling back to some default
 * would defeat the point of a fixture file (a test that thinks it's
 * checking FileEnricher's output would actually be checking the fallback).
 */
export function FileEnricher(path: string): Enricher {
  const load = makeLoader<EnrichResult>(path);
  return {
    name: `file:${path}`,
    async enrich(req: EnrichRequest): Promise<EnrichResult> {
      const table = await load();
      const key = wordKey(req.surface, req.reading);
      const result = table[key];
      if (!result) {
        throw new Error(`FileEnricher(${path})：找不到 "${key}" 的預錄結果`);
      }
      return result;
    },
  };
}

/**
 * Judge whose answers come from a pre-recorded JSON file at `path` (object
 * keyed by "surface|reading" -> JudgeResult). Throws if a requested word
 * isn't in the file, for the same reason FileEnricher does.
 */
export function FileJudge(path: string): Judge {
  const load = makeLoader<JudgeResult>(path);
  return {
    name: `file:${path}`,
    async judge(req: JudgeRequest): Promise<JudgeResult> {
      const table = await load();
      const key = wordKey(req.surface, req.reading);
      const result = table[key];
      if (!result) {
        throw new Error(`FileJudge(${path})：找不到 "${key}" 的預錄結果`);
      }
      return result;
    },
  };
}
