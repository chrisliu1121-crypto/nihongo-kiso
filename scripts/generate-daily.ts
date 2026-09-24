// scripts/generate-daily.ts — build task 2026-09 step 6, DESIGN.md §9.1/§12
// step 6: picks the next N not-yet-seen words off the frequency table, asks
// a pluggable Enricher to fill in "how to say it" (example/collocations/
// note), writes a data/pending/YYYY-MM-DD.json candidate, runs it through
// the same program validation data/words/*.json gets, then asks a pluggable
// Judge to independently sanity-check each candidate before it's allowed
// into data/words/ at all (§9.1's pipeline diagram).
//
// Run directly with Node's native TypeScript support, same as build-bank.ts
// -- every relative import here needs an explicit ".ts" extension for the
// same reason (see build-bank.ts's own header comment).
//
// CLI:
//   --date YYYY-MM-DD   default: today (local time)
//   --enricher NAME     stub | file:<path> | claude | openrouter   (default: stub)
//   --judge NAME        stub | file:<path> | claude | openrouter   (default: stub)
//   --model ID          model id override for the openrouter provider (falls back to
//                        OPENROUTER_MODEL env var, then a built-in default); ignored by
//                        stub/file/claude
//   --promote           move the day file into data/words/ if every word passed judging
//   --dry-run           print which words would be picked and stop -- no AI call, no file written
//   --force             overwrite an existing data/pending/<date>.json from a previous run
//                        (never overwrites data/words/<date>.json -- see main()'s first check;
//                        there is deliberately no way to force THAT one, review item 1)
//
// (There used to be a --count flag; removed -- WORDS_PER_DAY is a fixed
// constant everywhere else in this codebase, so exposing it as a CLI knob
// only invited generating a day that validateWordFile would then reject
// anyway. Review item 6.)

import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { todayKey } from "../src/lib/bank/dates.ts";
import type { DaySeed, PartOfSpeech, WordSeed } from "../src/lib/bank/types.ts";
import type { Enricher, EnrichRequest, EnrichResult } from "./lib/ai/enricher.ts";
import type { Judge, JudgeRequest, JudgeResult } from "./lib/ai/judge.ts";
import { StubEnricher, StubJudge } from "./lib/ai/stub.ts";
import { FileEnricher, FileJudge } from "./lib/ai/file.ts";
import { AiProviderError, type AiProviderErrorKind } from "./lib/ai/errors.ts";
import {
  buildWordCtx,
  collectExistingExampleJa,
  collectExistingExampleSurfaces,
  fileExists,
  FREQUENCY_PATH,
  loadExistingWordDays,
  nextWordIds,
  PENDING_DIR,
  pendingPath,
  wordsPath,
  type AttemptRecord,
  type PendingDayFile,
  type PipelineErrorEntry,
  type PipelineMeta,
  type SkippedEntry,
} from "./lib/pending.ts";
import { BuildError, validateWordFile, validateWordStandalone, WORDS_PER_DAY, type RawDay } from "./lib/validate-words.ts";

// ---------------------------------------------------------------------------
// 2026-09-17 "卡死" fix (DESIGN.md §9.1 "逐詞重試與替補"): 2026-09-16/17's
// cron both failed on the exact same 10-word batch (rank 51-60) because one
// bad word (番号 using the out-of-scope kanji 号) made validate-words.ts's
// FIRST BuildError abort the entire day's file before judge ever ran, and
// the next night's run picked the identical batch again with zero memory of
// what went wrong. MAX_ATTEMPTS_PER_WORD/MAX_CANDIDATES below are what let a
// single bad candidate get retried (with feedback) or skipped in favor of
// the next-ranked word, instead of taking the whole day down with it.
export const MAX_ATTEMPTS_PER_WORD = 3;
export const MAX_CANDIDATES = 14;

function isSystemicProviderErrorKind(kind: AiProviderErrorKind): boolean {
  // 2026-09-18 P1 fix: "rate_limit" (HTTP 429) joins the systemic set --
  // openrouter.ts's own backoff-retry logic already burned 3 retries before
  // ever throwing this, so by the time generate-daily.ts sees it, the
  // service really is refusing requests, not just momentarily busy. See
  // errors.ts's AiProviderErrorKind doc comment for why it's a distinct
  // kind from "http" rather than folded into it.
  return kind === "auth" || kind === "http" || kind === "network" || kind === "rate_limit";
}

// ---------------------------------------------------------------------------
// Frequency table (DESIGN.md §12 step 6, data/frequency/n5.json)

export interface FrequencyWord {
  rank: number;
  surface: string;
  reading: string;
  gloss: string;
  pos: PartOfSpeech;
}

export interface FrequencyFile {
  source: string;
  words: FrequencyWord[];
}

// ---------------------------------------------------------------------------
// Pure functions (scripts/__tests__/generate-daily.test.ts exercises these
// directly, with no filesystem or AI involved).

/**
 * The next `count` frequency-table entries whose surface+reading isn't
 * already in `existingKeys` (DESIGN.md §9: "頻率表決定學什麼"). Throws (not
 * a silent short list) when the table runs out before `count` is reached --
 * generate-daily should never quietly hand back fewer than asked for.
 */
export function pickNextWords(
  freq: readonly FrequencyWord[],
  existingKeys: ReadonlySet<string>,
  count: number,
): FrequencyWord[] {
  const picked: FrequencyWord[] = [];
  if (count <= 0) return picked;
  for (const w of freq) {
    if (existingKeys.has(`${w.surface}|${w.reading}`)) continue;
    picked.push(w);
    if (picked.length === count) break;
  }
  if (picked.length < count) {
    throw new Error(`頻率表剩餘可用詞不足：需要 ${count} 個，只找到 ${picked.length} 個尚未收錄的詞`);
  }
  return picked;
}

/**
 * 2026-09-17 "卡死" fix sibling of pickNextWords above: instead of exactly
 * `maxCount` words (throwing if the table can't supply that many),
 * pickCandidatePool returns UP TO `maxCount` -- the candidate POOL
 * runGenerationPipeline works through one at a time, accepting some and
 * skipping others, until either WORDS_PER_DAY are accepted or the pool runs
 * out. A short pool (fewer than `maxCount` words left in the table) is not
 * an error here the way it is for pickNextWords -- "ran out of candidates"
 * is exactly the "不滿 10 → 寫 pending" case main() itself already handles.
 */
export function pickCandidatePool(
  freq: readonly FrequencyWord[],
  existingKeys: ReadonlySet<string>,
  maxCount: number,
): FrequencyWord[] {
  const picked: FrequencyWord[] = [];
  for (const w of freq) {
    if (existingKeys.has(`${w.surface}|${w.reading}`)) continue;
    picked.push(w);
    if (picked.length === maxCount) break;
  }
  return picked;
}

/**
 * Combine one frequency-table entry with its Enricher output into a
 * WordSeed candidate (DESIGN.md §8.2 shape). `verified` always starts
 * false -- only applyJudgments (after a Judge has actually looked at it)
 * may set it true.
 */
export function assembleSeed(freqWord: FrequencyWord, enriched: import("./lib/ai/enricher.ts").EnrichResult, id: string): WordSeed {
  return {
    id,
    surface: freqWord.surface,
    reading: freqWord.reading,
    gloss: freqWord.gloss,
    pos: freqWord.pos,
    level: "N5",
    freq_rank: freqWord.rank,
    romaji_override: null,
    example: enriched.example,
    collocations: enriched.collocations,
    confusable_with: [],
    note: enriched.note,
    pitch: null,
    audio: null,
    source: "n5-freq",
    verified: false,
  };
}

/**
 * Apply a Judge's verdicts to a day's words: a word is `verified: true` iff
 * it has a judgment AND that judgment is clean (natural/reading_ok/gloss_ok
 * all true, no issues) -- DESIGN.md §9.1/§9.3: unreviewed or flagged content
 * never silently becomes verified.
 */
export function applyJudgments(words: readonly WordSeed[], judgments: Readonly<Record<string, JudgeResult>>): WordSeed[] {
  return words.map((w) => {
    const j = judgments[w.id];
    const clean = !!j && j.natural && j.reading_ok && j.gloss_ok && j.issues.length === 0;
    return { ...w, verified: clean };
  });
}

/** True iff every word in the day is verified AND the day has the required word count -- DESIGN.md §9.1: "全部一致才 verified: true → 上線". */
export function canPromote(words: readonly WordSeed[]): boolean {
  return words.length === WORDS_PER_DAY && words.every((w) => w.verified === true);
}

// ---------------------------------------------------------------------------
// Enrich phase (code review item 1, P0). Extracted out of main() into its
// own exported function so it's directly testable with an offline Enricher
// (e.g. FileEnricher) and a small candidate list, without going through the
// CLI/main() -- which always asks for exactly WORDS_PER_DAY candidates and
// isn't parameterizable by word count. See
// scripts/__tests__/generate-daily-partial-enrich-failure.test.ts.

export interface EnrichBatchResult {
  words: WordSeed[];
  errors: PipelineErrorEntry[];
}

/**
 * Enrich every candidate, one at a time. A per-word AiProviderError
 * (openrouter.ts/claude.ts on 401/5xx/network/schema/truncated/refusal,
 * FileEnricher on "word not found in fixture") is caught, recorded into
 * `errors`, and does NOT stop the batch -- this is the fix for the P0
 * "provider errors vanish, no pending written" report: previously any
 * enrich() failure propagated straight up and out of main() before
 * writePending() was ever called, so a mid-batch failure left nothing on
 * disk for a human to review. Any OTHER exception (a real bug, not a
 * provider failure) is NOT caught here and propagates as before.
 */
export async function enrichCandidates(
  candidates: readonly FrequencyWord[],
  ids: readonly string[],
  enricher: Enricher,
  existingSurfaces: readonly string[],
  level = "N5",
): Promise<EnrichBatchResult> {
  const words: WordSeed[] = [];
  const errors: PipelineErrorEntry[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const req: EnrichRequest = {
      surface: c.surface,
      reading: c.reading,
      gloss: c.gloss,
      pos: c.pos,
      level,
      existing_surfaces: [...existingSurfaces],
    };
    try {
      const enriched = await enricher.enrich(req);
      words.push(assembleSeed(c, enriched, ids[i]));
    } catch (err) {
      if (err instanceof AiProviderError) {
        console.error(`[generate-daily] ${c.surface}（${c.reading}）enrich 失敗（${err.kind}）：${err.detail}`);
        errors.push({
          id: ids[i],
          surface: c.surface,
          reading: c.reading,
          gloss: c.gloss,
          pos: c.pos,
          level,
          freq_rank: c.rank,
          kind: err.kind,
          detail: err.detail,
          stage: "enrich",
        });
        continue;
      }
      throw err;
    }
  }
  return { words, errors };
}

// ---------------------------------------------------------------------------
// Enricher/Judge selection. `claude` and `openrouter` are loaded via dynamic
// import ONLY when actually requested, specifically so the stub/file paths
// (and every test in this repo) never touch @anthropic-ai/sdk -- see
// scripts/lib/ai/claude.ts's own header comment. openrouter.ts itself never
// imports the SDK (pure fetch), but it's still gated behind a dynamic
// import for the same reason claude.ts is: a static top-level import here
// would defeat the whole point of `loaders` letting tests prove the module
// boundary without touching the real network-capable module. The `loaders`
// param exists purely so tests can prove that without touching the real
// module: pass a loader that throws, and assert it's never called for
// "stub"/"file:...".
export interface AiLoaders {
  loadClaudeEnricher?: () => Promise<Enricher>;
  loadClaudeJudge?: () => Promise<Judge>;
  loadOpenRouterEnricher?: (model?: string) => Promise<Enricher>;
  loadOpenRouterJudge?: (model?: string) => Promise<Judge>;
  /** Code review item 2 (P0): injectable loader for openrouter.ts's model-existence preflight, same reasoning as the loaders above -- lets tests prove the gating without touching the real dynamically-imported module. */
  loadOpenRouterPreflight?: () => Promise<(cliModel?: string) => Promise<void>>;
}

export async function resolveEnricher(spec: string, loaders: AiLoaders = {}, model?: string): Promise<Enricher> {
  if (spec === "stub") return StubEnricher;
  if (spec.startsWith("file:")) return FileEnricher(spec.slice("file:".length));
  if (spec === "claude") {
    const load = loaders.loadClaudeEnricher ?? (async () => (await import("./lib/ai/claude.ts")).ClaudeEnricher);
    return load();
  }
  if (spec === "openrouter") {
    const load =
      loaders.loadOpenRouterEnricher ??
      (async (m?: string) => (await import("./lib/ai/openrouter.ts")).makeOpenRouterEnricher({ model: m }));
    return load(model);
  }
  throw new Error(`未知的 --enricher：${spec}（可用：stub / file:<path> / claude / openrouter）`);
}

export async function resolveJudge(spec: string, loaders: AiLoaders = {}, model?: string): Promise<Judge> {
  if (spec === "stub") return StubJudge;
  if (spec.startsWith("file:")) return FileJudge(spec.slice("file:".length));
  if (spec === "claude") {
    const load = loaders.loadClaudeJudge ?? (async () => (await import("./lib/ai/claude.ts")).ClaudeJudge);
    return load();
  }
  if (spec === "openrouter") {
    const load =
      loaders.loadOpenRouterJudge ??
      (async (m?: string) => (await import("./lib/ai/openrouter.ts")).makeOpenRouterJudge({ model: m }));
    return load(model);
  }
  throw new Error(`未知的 --judge：${spec}（可用：stub / file:<path> / claude / openrouter）`);
}

/**
 * Code review item 2 (P0): if any of `specs` is "openrouter", confirm the
 * resolved model id actually exists on OpenRouter (openrouter.ts's
 * preflightOpenRouterModel) BEFORE any per-word enrich/judge call is made.
 * A no-op for stub/file/claude-only runs. Callers (generate-daily.ts's
 * main(), cross-check.ts's crossCheckOne) are expected to call this AFTER
 * their own --dry-run early-return (generate-daily.ts) and AFTER
 * resolveEnricher/resolveJudge have been resolved, but before the enrich/
 * judge loops themselves.
 *
 * Same dynamic-import gating as resolveEnricher/resolveJudge's "openrouter"
 * branch above, for the same isolation reason (openrouter.ts's own header
 * comment) -- and specifically so cross-check.ts, which must never mention
 * "ai/openrouter.ts" in its own source (scripts/lib/ai/__tests__/no-sdk-on-stub-path.test.ts),
 * can still trigger this preflight by calling this exported function
 * instead of importing openrouter.ts itself.
 */
export async function runOpenRouterPreflightIfNeeded(
  specs: readonly string[],
  model: string | undefined,
  loaders: AiLoaders = {},
): Promise<void> {
  if (!specs.includes("openrouter")) return;
  const load =
    loaders.loadOpenRouterPreflight ?? (async () => (await import("./lib/ai/openrouter.ts")).preflightOpenRouterModel);
  const preflight = await load();
  await preflight(model);
}

// ---------------------------------------------------------------------------
// CLI

export interface CliArgs {
  date: string;
  enricher: string;
  judge: string;
  model: string | undefined;
  promote: boolean;
  dryRun: boolean;
  force: boolean;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    date: todayKey(),
    enricher: "stub",
    judge: "stub",
    model: undefined,
    promote: false,
    dryRun: false,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--date":
        args.date = argv[++i];
        break;
      case "--enricher":
        args.enricher = argv[++i];
        break;
      case "--judge":
        args.judge = argv[++i];
        break;
      case "--model":
        args.model = argv[++i];
        break;
      case "--promote":
        args.promote = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--force":
        args.force = true;
        break;
      default:
        throw new Error(`未知的參數：${arg}`);
    }
  }
  return args;
}

async function loadFrequency(): Promise<FrequencyFile> {
  const raw = await readFile(FREQUENCY_PATH, "utf8");
  return JSON.parse(raw) as FrequencyFile;
}

/** Exported (was module-private) so scripts/__tests__/generate-daily-partial-enrich-failure.test.ts can write a pending file the same way main() does, without going through the CLI. */
export async function writePending(date: string, seed: DaySeed, pipeline: PipelineMeta): Promise<void> {
  await mkdir(PENDING_DIR, { recursive: true });
  const file: PendingDayFile = { ...seed, pipeline };
  await writeFile(pendingPath(date), JSON.stringify(file, null, 2) + "\n", "utf8");
}

function printCandidates(candidates: readonly FrequencyWord[]): void {
  for (const c of candidates) {
    console.log(`  #${c.rank}\t${c.surface}\t${c.reading}\t${c.gloss}\t${c.pos}`);
  }
}

/**
 * 2026-09-17 "卡死" fix: print every candidate that needed more than one
 * attempt (successful or not), with each failed attempt's stage and
 * problems -- this is what lets a human (or the acceptance run this
 * function's doc comment traces back to) actually SEE "一 在第 3 次通過"
 * in the CLI output, not just infer it from the pending file's `pipeline.attempts`.
 * A candidate that passed on attempt 1 has no entry in `attempts` at all
 * (see runGenerationPipeline) and is silently skipped here -- nothing
 * interesting happened for it.
 */
function printAttemptHistory(attempts: Readonly<Record<string, AttemptRecord[]>>, acceptedKeys: ReadonlySet<string>): void {
  for (const [key, records] of Object.entries(attempts)) {
    const outcome = acceptedKeys.has(key) ? `第 ${records.length + 1} 次通過` : `${records.length} 次嘗試全部失敗，已跳過`;
    console.log(`  [retry] ${key}：${outcome}`);
    for (const r of records) {
      console.log(`    #${r.attempt} (${r.stage})：${r.problems.join("；")}`);
    }
  }
}

/** Code review item 1 (P0): print a short per-word breakdown of a batch's AiProviderError failures, used by both the enrich phase and the judge phase below. */
export function printErrorSummary(date: string, phase: "enrich" | "judge" | "enrich/judge", errors: readonly PipelineErrorEntry[], succeededCount: number): void {
  console.error(
    `[generate-daily] ${date}：${errors.length} 個詞 ${phase} 失敗（${succeededCount} 詞成功），已寫入 ${pendingPath(date)} 供人工檢視 / scripts/cross-check.ts 重試`,
  );
  for (const e of errors) {
    console.error(`  ${e.id}\t${e.surface}\t${e.reading}\t${e.kind}：${e.detail}`);
  }
}

// ---------------------------------------------------------------------------
// Judge phase, factored out for the same reason enrichCandidates is (and
// reused as-is by scripts/cross-check.ts's crossCheckOne, so both scripts
// handle a mid-batch judge() AiProviderError failure identically instead of
// two hand-written copies drifting apart).

export interface JudgeBatchResult {
  judgments: Record<string, JudgeResult>;
  errors: PipelineErrorEntry[];
}

/**
 * Judge every word, one at a time. A per-word AiProviderError is caught,
 * recorded into `errors` (same shape/reasoning as enrichCandidates above --
 * this word simply has no judgment, applyJudgments already treats "no
 * judgment" as unverified), and does NOT stop the batch. Any other
 * exception propagates as before.
 */
export async function judgeWords(
  words: readonly WordSeed[],
  judge: Judge,
  existingExamples: readonly string[],
): Promise<JudgeBatchResult> {
  const judgments: Record<string, JudgeResult> = {};
  const errors: PipelineErrorEntry[] = [];
  for (const w of words) {
    const req: JudgeRequest = {
      surface: w.surface,
      reading: w.reading,
      gloss: w.gloss,
      example: w.example,
      existing_examples: [...existingExamples],
    };
    try {
      judgments[w.id] = await judge.judge(req);
    } catch (err) {
      if (err instanceof AiProviderError) {
        console.error(`[generate-daily] ${w.surface}（${w.reading}）judge 失敗（${err.kind}）：${err.detail}`);
        errors.push({
          id: w.id,
          surface: w.surface,
          reading: w.reading,
          gloss: w.gloss,
          pos: w.pos,
          level: w.level,
          freq_rank: w.freq_rank,
          kind: err.kind,
          detail: err.detail,
          stage: "judge",
        });
        continue;
      }
      throw err;
    }
  }
  return { judgments, errors };
}

// ---------------------------------------------------------------------------
// 2026-09-17 "卡死" fix: the core per-candidate attempt/retry/replace loop
// (DESIGN.md §9.1 "逐詞重試與替補"). Replaces main()'s old
// enrich-everything-then-validate-the-whole-file-then-judge-everything
// pipeline (still available above as enrichCandidates/judgeWords, kept
// unchanged for scripts/cross-check.ts's own retry pass, which this fix
// deliberately leaves alone) with a per-word loop: each candidate gets up
// to MAX_ATTEMPTS_PER_WORD tries (enrich -> validateWordStandalone -> judge,
// in that order, each gated on the previous step) before being skipped in
// favor of the next-ranked candidate. A failed attempt's problems become
// next attempt's EnrichRequest.feedback -- the AI is told exactly what to
// fix instead of repeating the same mistake with no memory of it, which is
// what actually happened on 2026-09-16 -> 2026-09-17.

export interface RunPipelineOptions {
  /** Candidate pool, already in rank order and already excluding anything on the bank (pickCandidatePool's output). */
  candidates: readonly FrequencyWord[];
  enricher: Enricher;
  judge: Judge;
  existingSurfaces: readonly string[];
  existingExamples: readonly string[];
  /** WordValidationCtx.knownKanji (buildWordCtx's output) -- also concatenated into EnrichRequest.allowed_kanji for each attempt. */
  knownKanji: ReadonlySet<string>;
  /** Every example.ja already published in data/words/*.json (WordValidationCtx.existingExampleJa's keys). */
  existingExampleJa: ReadonlySet<string>;
  /** Used only to label validateWordStandalone's messages (and, downstream, EnrichRequest.feedback text) -- "`${date}.json`" reads consistently with every other BuildError-style message this pipeline produces. */
  date: string;
  level?: string;
  /** Defaults to WORDS_PER_DAY; overridable so a test can ask for a small batch without building a full 10-word fixture. */
  wordsPerDay?: number;
  /** Defaults to MAX_ATTEMPTS_PER_WORD. */
  maxAttempts?: number;
}

/** One candidate whose every attempt (enrich, validate, or judge) failed -- or, if every attempt succeeded, its accepted result. */
export interface RunPipelineResult {
  accepted: Array<{ freqWord: FrequencyWord; enriched: EnrichResult; judgment: JudgeResult }>;
  skipped: SkippedEntry[];
  attempts: Record<string, AttemptRecord[]>;
  enrichCalls: number;
  judgeCalls: number;
  /**
   * Set iff a systemic AiProviderError (kind auth/http/network) was thrown
   * by ANY enrich()/judge() call -- the one case that still aborts the
   * whole run rather than being retried/skipped (DESIGN.md §9.1: "系統性錯
   * 誤立即中止整個執行"). `accepted`/`skipped`/`attempts` above still
   * reflect everything that happened before the abort.
   */
  aborted?: {
    kind: AiProviderErrorKind;
    detail: string;
    stage: "enrich" | "judge";
    candidate: FrequencyWord;
  };
}

/**
 * 2026-09-24: a non-AiProviderError exception (AI output hitting a shape the
 * assembly/validation code didn't anticipate) used to be rethrown, crashing
 * the whole night's run with nothing saved -- the 09-22 and 09-24 crons both
 * exited 1 with no pending file and no step summary. Now it is recorded as
 * this attempt's problem: retried with feedback like any other failure, and
 * the candidate is skipped/replaced once attempts run out. The full stack
 * goes to stderr (CI log) for later diagnosis.
 */
export function internalProblem(stage: "enrich" | "validate" | "judge", err: unknown): string {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(`[generate-daily] ${stage} 階段內部錯誤（${e.name}）：${e.message}\n${e.stack ?? ""}`);
  return `內部錯誤（${stage}，${e.name}）：${e.message}。請嚴格依照 schema 重新產生。`;
}

/**
 * On a top-level crash, write the error into $GITHUB_STEP_SUMMARY: on a public
 * repo the job log needs a login, the summary page does not. The
 * OPENROUTER_API_KEY value is redacted before writing.
 */
export async function writeCrashSummary(err: unknown): Promise<void> {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  const e = err instanceof Error ? err : new Error(String(err));
  let text = `${e.name}: ${e.message}\n${e.stack ?? ""}`;
  const key = process.env.OPENROUTER_API_KEY;
  if (key) text = text.split(key).join("[REDACTED]");
  const fence = "```";
  await appendFile(summaryPath, `## generate-daily 崩潰\n\n${fence}\n${text.slice(0, 4000)}\n${fence}\n`, "utf8");
}

export async function runGenerationPipeline(opts: RunPipelineOptions): Promise<RunPipelineResult> {
  const wordsPerDay = opts.wordsPerDay ?? WORDS_PER_DAY;
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS_PER_WORD;
  const level = opts.level ?? "N5";
  const allowedKanjiStr = [...opts.knownKanji].join("");
  const fileLabel = `${opts.date}.json`;

  const accepted: RunPipelineResult["accepted"] = [];
  const skipped: SkippedEntry[] = [];
  const attempts: Record<string, AttemptRecord[]> = {};
  // "surface|reading" example.ja -> the candidate key that produced it, so a
  // LATER candidate in this same run can't silently duplicate an EARLIER
  // one's accepted example (validateWordStandalone's batchExampleJa ctx).
  const batchExampleJa = new Map<string, string>();
  let enrichCalls = 0;
  let judgeCalls = 0;

  for (const candidate of opts.candidates) {
    if (accepted.length >= wordsPerDay) break;

    const key = `${candidate.surface}|${candidate.reading}`;
    const wordAttempts: AttemptRecord[] = [];
    let feedback: string[] = [];
    let acceptedThisCandidate: { enriched: EnrichResult; judgment: JudgeResult } | null = null;

    for (let attemptNum = 1; attemptNum <= maxAttempts; attemptNum++) {
      const req: EnrichRequest = {
        surface: candidate.surface,
        reading: candidate.reading,
        gloss: candidate.gloss,
        pos: candidate.pos,
        level,
        existing_surfaces: [...opts.existingSurfaces],
        allowed_kanji: allowedKanjiStr,
        feedback: [...feedback],
      };

      let enriched: EnrichResult;
      try {
        enrichCalls++;
        enriched = await opts.enricher.enrich(req);
      } catch (err) {
        if (err instanceof AiProviderError) {
          if (isSystemicProviderErrorKind(err.kind)) {
            if (wordAttempts.length > 0) attempts[key] = wordAttempts;
            return { accepted, skipped, attempts, enrichCalls, judgeCalls, aborted: { kind: err.kind, detail: err.detail, stage: "enrich", candidate } };
          }
          const problems = [`enrich 失敗（${err.kind}）：${err.detail}`];
          wordAttempts.push({ attempt: attemptNum, stage: "enrich", problems });
          feedback = problems;
          continue;
        }
        const problems = [internalProblem("enrich", err)];
        wordAttempts.push({ attempt: attemptNum, stage: "enrich", problems });
        feedback = problems;
        continue;
      }

      // "w_0000" is a placeholder that satisfies ID_RE (w_ + 4 digits) so
      // validateWordStandalone's own id-format check doesn't fire a bogus
      // problem for every attempt -- the real id is only assigned once this
      // candidate is accepted and the whole day's words are sorted by rank
      // (see main()'s finalizeWords).
      let validationProblems: string[];
      try {
        const candidateSeed: WordSeed = assembleSeed(candidate, enriched, "w_0000");
        validationProblems = validateWordStandalone(
          candidateSeed,
          { knownKanji: opts.knownKanji, existingExampleJa: opts.existingExampleJa, batchExampleJa },
          fileLabel,
        );
      } catch (err) {
        validationProblems = [internalProblem("validate", err)];
      }
      if (validationProblems.length > 0) {
        wordAttempts.push({ attempt: attemptNum, stage: "validate", problems: validationProblems });
        feedback = validationProblems;
        continue;
      }

      let judgment: JudgeResult;
      try {
        judgeCalls++;
        judgment = await opts.judge.judge({
          surface: candidate.surface,
          reading: candidate.reading,
          gloss: candidate.gloss,
          example: enriched.example,
          existing_examples: [...opts.existingExamples],
        });
      } catch (err) {
        if (err instanceof AiProviderError) {
          if (isSystemicProviderErrorKind(err.kind)) {
            if (wordAttempts.length > 0) attempts[key] = wordAttempts;
            return { accepted, skipped, attempts, enrichCalls, judgeCalls, aborted: { kind: err.kind, detail: err.detail, stage: "judge", candidate } };
          }
          const problems = [`judge 失敗（${err.kind}）：${err.detail}`];
          wordAttempts.push({ attempt: attemptNum, stage: "judge", problems });
          feedback = problems;
          continue;
        }
        const problems = [internalProblem("judge", err)];
        wordAttempts.push({ attempt: attemptNum, stage: "judge", problems });
        feedback = problems;
        continue;
      }

      const clean = judgment.natural && judgment.reading_ok && judgment.gloss_ok && judgment.issues.length === 0;
      if (!clean) {
        const problems = judgment.issues.length > 0 ? judgment.issues : ["judge 未通過（無 issues）"];
        wordAttempts.push({ attempt: attemptNum, stage: "judge", problems });
        feedback = problems;
        continue;
      }

      acceptedThisCandidate = { enriched, judgment };
      break;
    }

    if (wordAttempts.length > 0) attempts[key] = wordAttempts;

    if (acceptedThisCandidate) {
      accepted.push({ freqWord: candidate, enriched: acceptedThisCandidate.enriched, judgment: acceptedThisCandidate.judgment });
      batchExampleJa.set(acceptedThisCandidate.enriched.example.ja, key);
    } else {
      skipped.push({
        surface: candidate.surface,
        reading: candidate.reading,
        rank: candidate.rank,
        problems: wordAttempts.flatMap((a) => a.problems),
      });
    }
  }

  return { accepted, skipped, attempts, enrichCalls, judgeCalls };
}

/**
 * Sort a RunPipelineResult's accepted candidates by rank and assign them
 * real, permanent ids (nextWordIds, continuing from the bank's current max
 * -- DESIGN.md §8.6) -- shared by every main() branch (abort / too-few /
 * full-10) so id assignment always behaves identically regardless of which
 * branch is writing the pending/words file. Every returned word is
 * `verified: true`: acceptance into RunPipelineResult.accepted already
 * REQUIRED a clean judge verdict (see runGenerationPipeline above), so
 * there is no "accepted but unverified" state in this pipeline the way the
 * old enrich-all/judge-all flow had.
 */
export function finalizeAcceptedWords(
  existingDays: readonly RawDay[],
  accepted: RunPipelineResult["accepted"],
): { words: WordSeed[]; judgments: Record<string, JudgeResult> } {
  const sorted = [...accepted].sort((a, b) => a.freqWord.rank - b.freqWord.rank);
  const ids = nextWordIds(existingDays as RawDay[], sorted.length);
  const judgments: Record<string, JudgeResult> = {};
  const words = sorted.map((a, i) => {
    const id = ids[i];
    judgments[id] = a.judgment;
    return { ...assembleSeed(a.freqWord, a.enriched, id), verified: true };
  });
  return { words, judgments };
}

/**
 * 2026-09-18 P2 fix: a skipped candidate's `problems` is the flattened
 * concatenation of every failed attempt's problems (runGenerationPipeline's
 * own `skipped.push({ ..., problems: wordAttempts.flatMap(...) })`) -- when
 * the SAME mistake repeats across attempts (the exact "AI keeps making the
 * same mistake" pattern this whole fix exists to catch and correct), that
 * one sentence would otherwise print 2-3 times in a row in both the CLI
 * output and the step summary. This collapses consecutive-or-not duplicates
 * to one line with a `（×N）` count suffix, preserving first-occurrence
 * order. Deliberately ONLY a display-time transform: the pending file's own
 * `pipeline.attempts`/`pipeline.skipped` (writePending's input) keep every
 * attempt's problems exactly as produced, undeduplicated -- that's the
 * record a human or a future run needs to see in full.
 */
export function dedupProblemsForDisplay(problems: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const p of problems) counts.set(p, (counts.get(p) ?? 0) + 1);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of problems) {
    if (seen.has(p)) continue;
    seen.add(p);
    const count = counts.get(p)!;
    out.push(count > 1 ? `${p}（×${count}）` : p);
  }
  return out;
}

/** Appends a markdown section to $GITHUB_STEP_SUMMARY (a no-op off CI, where that env var is unset) -- DESIGN.md §9.1: date, the accepted words (surface + example), every skipped word with its per-attempt problems, and the total AI call count. */
export async function writeStepSummary(
  date: string,
  words: readonly WordSeed[],
  skipped: readonly SkippedEntry[],
  totalAiCalls: number,
): Promise<void> {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  const lines: string[] = [`## generate-daily：${date}`, "", `共 ${totalAiCalls} 次 AI 呼叫（enrich + judge）。`, ""];
  lines.push(`### 接受的詞（${words.length}）`);
  for (const w of words) {
    lines.push(`- **${w.surface}**（${w.reading}）— ${w.example.ja}`);
  }
  if (skipped.length > 0) {
    lines.push("", `### 跳過的詞（${skipped.length}）`);
    for (const s of skipped) {
      lines.push(`- **${s.surface}**（${s.reading}，rank ${s.rank}）`);
      for (const p of dedupProblemsForDisplay(s.problems)) lines.push(`  - ${p}`);
    }
  }
  lines.push("");
  await appendFile(summaryPath, lines.join("\n") + "\n", "utf8");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Review item 1 (P0): a date that already has OFFICIAL data is off
  // limits, full stop -- checked first, unconditionally, before touching
  // the frequency table or writing anything. There is no --force for this
  // one: data/words/*.json is the published bank (DESIGN.md §8.6 -- ids
  // and everything downstream of them are permanent once published), and a
  // script silently regenerating it is exactly the kind of "success that
  // isn't" this whole pipeline exists to prevent. Regenerating a finalized
  // day is a human decision (edit data/words/ by hand, or pick a new date).
  //
  // Code review item 5 (P2): that said, this is a no-op, not a failure --
  // "already generated today" is the expected steady state for a daily
  // cron that might get triggered more than once (e.g. a manual re-run of
  // the same workflow), not something a human needs to triage. exit(0),
  // unlike the pending-file guard just below (which stays an error: a
  // pending file can hold unreviewed AI output or hand edits -- "there's
  // already something to look at" is NOT the same situation as "there's
  // nothing left to do").
  if (await fileExists(wordsPath(args.date))) {
    console.log(`[generate-daily] ${args.date} 該日已有正式資料，無事可做`);
    process.exit(0);
  }

  const freq = await loadFrequency();
  const existingDays: RawDay[] = await loadExistingWordDays();
  const existingKeys = new Set(
    existingDays.flatMap((d) => d.seed.words.map((w) => `${w.surface}|${w.reading}`)),
  );

  // 2026-09-17 "卡死" fix (DESIGN.md §9.1): the candidate POOL is bigger
  // than WORDS_PER_DAY (up to MAX_CANDIDATES) specifically so a bad
  // candidate has somewhere to be replaced FROM -- pickNextWords (still
  // used by --dry-run's preview below, which is about "what WOULD today
  // pick", not the actual attempt/retry loop) throws when the table runs
  // short; pickCandidatePool doesn't, because running short here just means
  // "fewer than WORDS_PER_DAY get accepted", which main() already has a
  // dedicated (non-crashing) branch for below.
  const candidatePool = pickCandidatePool(freq.words, existingKeys, MAX_CANDIDATES);

  if (args.dryRun) {
    console.log(
      `[dry-run] ${args.date} 候選池（enricher=${args.enricher}, judge=${args.judge}, 最多嘗試 ${candidatePool.length} 個候選取 ${WORDS_PER_DAY} 詞）：`,
    );
    printCandidates(candidatePool);
    return;
  }

  // Review item 2 (P1): a pending file from a previous run might already
  // hold hand edits (§9.4/§6.2 review flow) -- silently overwriting it with
  // a fresh AI pass would throw that work away. --force is the explicit
  // "yes, discard it and regenerate" escape hatch; the default path points
  // at cross-check.ts instead, which re-validates/re-judges what's already
  // there without touching its content.
  if (!args.force && (await fileExists(pendingPath(args.date)))) {
    console.error(
      `[generate-daily] 拒絕：${pendingPath(args.date)} 已存在。若已人工編輯過，請改用 scripts/cross-check.ts 重新驗證/判讀；` +
        `要放棄現有內容、重新產生，請加 --force。`,
    );
    process.exit(1);
  }

  const enricher = await resolveEnricher(args.enricher, {}, args.model);
  const judge = await resolveJudge(args.judge, {}, args.model);

  // Code review item 2 (P0): before ANY per-word enrich/judge call, confirm
  // the resolved OpenRouter model actually exists (no-op for stub/file/
  // claude). Placed after resolveEnricher/resolveJudge (object construction
  // only, no network) and after the dry-run/force guards above, so
  // --dry-run never reaches this and never needs a key or network -- and
  // (critical, verified empirically) AFTER this point OPENROUTER_API_KEY is
  // guaranteed checked first thing inside the preflight itself, before its
  // own network call, so a missing key still fails the same way it always
  // has instead of hanging on a network request.
  await runOpenRouterPreflightIfNeeded([args.enricher, args.judge], args.model);

  const existingSurfaces = collectExistingExampleSurfaces(existingDays);
  const existingExamples = collectExistingExampleJa(existingDays);
  const ctx = buildWordCtx(existingDays, freq.words.map((w) => w.surface));

  const result = await runGenerationPipeline({
    candidates: candidatePool,
    enricher,
    judge,
    existingSurfaces,
    existingExamples,
    knownKanji: ctx.knownKanji,
    existingExampleJa: new Set(ctx.existingExampleJa.keys()),
    date: args.date,
  });

  const { words, judgments } = finalizeAcceptedWords(existingDays, result.accepted);
  // 2026-09-18 P1 fix: prefer each provider's own requestCount() (actual
  // HTTP requests made, including openrouter.ts's internal backoff
  // retries) over the pipeline's logical per-word call counters, so the
  // step summary's "AI 呼叫次數" is honest about retries instead of
  // undercounting them. stub/file/claude never retry at this layer, so
  // their logical count already equals their true request count and
  // requestCount() is simply absent for them (see Enricher.requestCount's
  // own doc comment).
  const totalAiCalls = (enricher.requestCount?.() ?? result.enrichCalls) + (judge.requestCount?.() ?? result.judgeCalls);
  const acceptedKeys = new Set(result.accepted.map((a) => `${a.freqWord.surface}|${a.freqWord.reading}`));

  // Case 1 (DESIGN.md §9.1): a systemic provider error (auth/http/network)
  // aborts the run outright -- no retry, no replacement candidate, whatever
  // was already accepted is written to pending as-is.
  if (result.aborted) {
    const abortEntry: PipelineErrorEntry = {
      id: "-",
      surface: result.aborted.candidate.surface,
      reading: result.aborted.candidate.reading,
      gloss: result.aborted.candidate.gloss,
      pos: result.aborted.candidate.pos,
      level: "N5",
      freq_rank: result.aborted.candidate.rank,
      kind: result.aborted.kind,
      detail: result.aborted.detail,
      stage: result.aborted.stage,
    };
    const pipeline: PipelineMeta = {
      enricher: enricher.name,
      judge: judge.name,
      generated_at: new Date().toISOString(),
      judgments,
      errors: [abortEntry],
      attempts: result.attempts,
      skipped: result.skipped,
    };
    await writePending(args.date, { date: args.date, words }, pipeline);
    await writeStepSummary(args.date, words, result.skipped, totalAiCalls);
    console.error(
      `[generate-daily] ${args.date}：系統性錯誤（${abortEntry.kind}）中止整個執行（候選 ${abortEntry.surface}／${abortEntry.reading}，${result.aborted.stage} 階段）：${abortEntry.detail}`,
    );
    console.error(`[generate-daily] pending 檔案保留（已接受 ${words.length} 詞）：${pendingPath(args.date)}`);
    printAttemptHistory(result.attempts, acceptedKeys);
    process.exit(2);
  }

  const pipeline: PipelineMeta = {
    enricher: enricher.name,
    judge: judge.name,
    generated_at: new Date().toISOString(),
    judgments,
    errors: [],
    attempts: result.attempts,
    skipped: result.skipped,
  };
  const daySeed: DaySeed = { date: args.date, words };
  await writePending(args.date, daySeed, pipeline);
  await writeStepSummary(args.date, words, result.skipped, totalAiCalls);

  console.log(
    `[generate-daily] ${args.date}：接受 ${words.length}/${WORDS_PER_DAY} 詞，跳過 ${result.skipped.length} 個候選，enricher=${enricher.name}, judge=${judge.name}, 共 ${totalAiCalls} 次 AI 呼叫`,
  );
  for (const w of words) {
    console.log(`  ${w.id}\t${w.surface}\t${w.reading}\tverified`);
  }
  for (const s of result.skipped) {
    console.log(`  (skipped)\t${s.surface}\t${s.reading}\trank ${s.rank}\t${dedupProblemsForDisplay(s.problems).join("；") || "(無詳細問題)"}`);
  }
  printAttemptHistory(result.attempts, acceptedKeys);

  // Case 2: the candidate pool ran out (or MAX_CANDIDATES was exhausted)
  // before WORDS_PER_DAY words were accepted -- not a crash, but not a
  // day's worth of content either. Same "leave pending for tomorrow's run
  // to pick up where it left off" shape the rest of this pipeline already
  // has; the skipped candidates are deliberately NOT blacklisted (DESIGN.md
  // §9.1: they're simply first in line again next run).
  if (words.length < WORDS_PER_DAY) {
    console.error(`[generate-daily] ${args.date}：候選池用盡（試了 ${candidatePool.length} 個），僅接受 ${words.length}/${WORDS_PER_DAY} 詞，pending 檔案保留：${pendingPath(args.date)}`);
    process.exit(1);
  }

  // Case 3: exactly WORDS_PER_DAY accepted.
  if (args.promote) {
    // Final defense-in-depth gate (DESIGN.md §9.1 "再跑一次 validateWordFile
    // 做整檔檢查"): validateWordStandalone above already checked every word
    // in isolation, but never checked id/surface+reading/freq_rank
    // uniqueness or confusable_with symmetry against the rest of the bank --
    // validateWordFile is still the authority for those, unchanged.
    try {
      validateWordFile(`${args.date}.json`, daySeed, ctx);
    } catch (err) {
      if (err instanceof BuildError) {
        console.error(`[generate-daily] 驗證失敗：${err.message}`);
        console.error(`[generate-daily] pending 檔案保留：${pendingPath(args.date)}`);
        process.exit(1);
      }
      throw err;
    }

    if (canPromote(words)) {
      await writeFile(wordsPath(args.date), JSON.stringify(daySeed, null, 2) + "\n", "utf8");
      await rm(pendingPath(args.date));
      console.log(`[generate-daily] 已 promote：${wordsPath(args.date)}`);
    } else {
      // Unreachable in practice (every accepted word is already
      // verified:true -- see finalizeAcceptedWords), kept as a defensive
      // fallback so a future change to that invariant fails loud instead of
      // promoting something unverified.
      console.error(`[generate-daily] 無法 promote：canPromote 判定為否，pending 檔案保留：${pendingPath(args.date)}`);
      process.exit(1);
    }
  } else {
    console.log(`[generate-daily] 尚未 promote（未帶 --promote），結果留在 ${pendingPath(args.date)}`);
  }
}

// CLI guard: only run when this file is the process entry point, so tests
// can import the pure helpers above without side effects (same pattern as
// build-bank.ts).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(async (err: unknown) => {
    console.error(err);
    await writeCrashSummary(err).catch(() => {});
    process.exit(1);
  });
}
