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
//   --enricher NAME     stub | file:<path> | claude   (default: stub)
//   --judge NAME        stub | file:<path> | claude   (default: stub)
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

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { todayKey } from "../src/lib/bank/dates.ts";
import type { DaySeed, PartOfSpeech, WordSeed } from "../src/lib/bank/types.ts";
import type { Enricher, EnrichRequest } from "./lib/ai/enricher.ts";
import type { Judge, JudgeRequest, JudgeResult } from "./lib/ai/judge.ts";
import { StubEnricher, StubJudge } from "./lib/ai/stub.ts";
import { FileEnricher, FileJudge } from "./lib/ai/file.ts";
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
  type PendingDayFile,
  type PipelineMeta,
} from "./lib/pending.ts";
import { BuildError, validateWordFile, WORDS_PER_DAY, type RawDay } from "./lib/validate-words.ts";

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
// Enricher/Judge selection. `claude` is loaded via dynamic import ONLY when
// actually requested, specifically so the stub/file paths (and every test
// in this repo) never touch @anthropic-ai/sdk -- see scripts/lib/ai/claude.ts's
// own header comment. The `loaders` param exists purely so tests can prove
// that without touching the real module: pass a loader that throws, and
// assert it's never called for "stub"/"file:...".
export interface AiLoaders {
  loadClaudeEnricher?: () => Promise<Enricher>;
  loadClaudeJudge?: () => Promise<Judge>;
}

export async function resolveEnricher(spec: string, loaders: AiLoaders = {}): Promise<Enricher> {
  if (spec === "stub") return StubEnricher;
  if (spec.startsWith("file:")) return FileEnricher(spec.slice("file:".length));
  if (spec === "claude") {
    const load = loaders.loadClaudeEnricher ?? (async () => (await import("./lib/ai/claude.ts")).ClaudeEnricher);
    return load();
  }
  throw new Error(`未知的 --enricher：${spec}（可用：stub / file:<path> / claude）`);
}

export async function resolveJudge(spec: string, loaders: AiLoaders = {}): Promise<Judge> {
  if (spec === "stub") return StubJudge;
  if (spec.startsWith("file:")) return FileJudge(spec.slice("file:".length));
  if (spec === "claude") {
    const load = loaders.loadClaudeJudge ?? (async () => (await import("./lib/ai/claude.ts")).ClaudeJudge);
    return load();
  }
  throw new Error(`未知的 --judge：${spec}（可用：stub / file:<path> / claude）`);
}

// ---------------------------------------------------------------------------
// CLI

export interface CliArgs {
  date: string;
  enricher: string;
  judge: string;
  promote: boolean;
  dryRun: boolean;
  force: boolean;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { date: todayKey(), enricher: "stub", judge: "stub", promote: false, dryRun: false, force: false };
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

async function writePending(date: string, seed: DaySeed, pipeline: PipelineMeta): Promise<void> {
  await mkdir(PENDING_DIR, { recursive: true });
  const file: PendingDayFile = { ...seed, pipeline };
  await writeFile(pendingPath(date), JSON.stringify(file, null, 2) + "\n", "utf8");
}

function printCandidates(candidates: readonly FrequencyWord[]): void {
  for (const c of candidates) {
    console.log(`  #${c.rank}\t${c.surface}\t${c.reading}\t${c.gloss}\t${c.pos}`);
  }
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
  if (await fileExists(wordsPath(args.date))) {
    console.error(`[generate-daily] 拒絕：${args.date} 該日期已有正式資料（${wordsPath(args.date)}），不會重新產生或覆寫。`);
    process.exit(1);
  }

  const freq = await loadFrequency();
  const existingDays: RawDay[] = await loadExistingWordDays();
  const existingKeys = new Set(
    existingDays.flatMap((d) => d.seed.words.map((w) => `${w.surface}|${w.reading}`)),
  );

  let candidates: FrequencyWord[];
  try {
    candidates = pickNextWords(freq.words, existingKeys, WORDS_PER_DAY);
  } catch (err) {
    console.error(`[generate-daily] ${(err as Error).message}`);
    process.exit(1);
  }

  if (args.dryRun) {
    console.log(`[dry-run] ${args.date} 會選出以下 ${candidates.length} 個詞（enricher=${args.enricher}, judge=${args.judge}）：`);
    printCandidates(candidates);
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

  const enricher = await resolveEnricher(args.enricher);
  const judge = await resolveJudge(args.judge);

  const existingSurfaces = collectExistingExampleSurfaces(existingDays);
  const existingExamples = collectExistingExampleJa(existingDays);
  const ids = nextWordIds(existingDays, candidates.length);

  const words: WordSeed[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const req: EnrichRequest = {
      surface: c.surface,
      reading: c.reading,
      gloss: c.gloss,
      pos: c.pos,
      level: "N5",
      existing_surfaces: existingSurfaces,
    };
    const enriched = await enricher.enrich(req);
    words.push(assembleSeed(c, enriched, ids[i]));
  }

  const daySeed: DaySeed = { date: args.date, words };
  const pipeline: PipelineMeta = {
    enricher: enricher.name,
    judge: judge.name,
    generated_at: new Date().toISOString(),
    judgments: {},
  };

  await writePending(args.date, daySeed, pipeline);

  const ctx = buildWordCtx(existingDays, freq.words.map((w) => w.surface));
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

  const judgments: Record<string, JudgeResult> = {};
  for (const w of words) {
    const req: JudgeRequest = {
      surface: w.surface,
      reading: w.reading,
      gloss: w.gloss,
      example: w.example,
      existing_examples: existingExamples,
    };
    judgments[w.id] = await judge.judge(req);
  }

  const judgedWords = applyJudgments(words, judgments);
  pipeline.judgments = judgments;
  await writePending(args.date, { date: args.date, words: judgedWords }, pipeline);

  console.log(`[generate-daily] ${args.date}：${judgedWords.length} 詞，enricher=${enricher.name}, judge=${judge.name}`);
  for (const w of judgedWords) {
    const issues = judgments[w.id]?.issues ?? [];
    const status = w.verified ? "verified" : `未通過${issues.length ? "：" + issues.join("；") : ""}`;
    console.log(`  ${w.id}\t${w.surface}\t${w.reading}\t${status}`);
  }

  if (args.promote) {
    if (canPromote(judgedWords)) {
      const finalSeed: DaySeed = { date: args.date, words: judgedWords };
      await writeFile(wordsPath(args.date), JSON.stringify(finalSeed, null, 2) + "\n", "utf8");
      await rm(pendingPath(args.date));
      console.log(`[generate-daily] 已 promote：${wordsPath(args.date)}`);
    } else {
      console.error(`[generate-daily] 無法 promote：尚有詞未通過 judge，pending 檔案保留：${pendingPath(args.date)}`);
      for (const w of judgedWords) {
        if (!w.verified) {
          const issues = judgments[w.id]?.issues ?? [];
          console.error(`  ${w.id}\t${w.surface}\t${issues.join("；") || "(無 issues，但 judge 未全部通過)"}`);
        }
      }
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
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
