// scripts/cross-check.ts — build task 2026-09 step 6, DESIGN.md §9.1 "cross-check.ts
// （二次 AI，不看第一次理由）". Re-runs the judge step (generate-daily.ts's
// step 5) against whatever is currently sitting in data/pending/*.json --
// meant for after a human has hand-edited a pending day (§6.2/§9.4: pending
// content is reviewed in Obsidian/an editor, not blindly trusted), or for
// re-judging with a different backend than the one that originally produced
// the candidate. Also re-runs program validation first (§9.2), since a hand
// edit can just as easily break `example.ja`/tokens agreement as an AI can.
//
// Run directly with Node's native TypeScript support, same as build-bank.ts
// / generate-daily.ts -- every relative import needs an explicit ".ts"
// extension for the same reason (see build-bank.ts's header comment).
//
// CLI:
//   --date YYYY-MM-DD   re-check only this pending day (default: every file in data/pending/)
//   --judge NAME        stub | file:<path> | claude   (default: stub)
//   --promote           promote each day that ends up fully verified

import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { DaySeed, WordSeed } from "../src/lib/bank/types.ts";
import type { JudgeRequest, JudgeResult } from "./lib/ai/judge.ts";
import { applyJudgments, canPromote, resolveJudge, type AiLoaders } from "./generate-daily.ts";
import {
  buildWordCtx,
  collectExistingExampleJa,
  fileExists,
  FREQUENCY_PATH,
  loadExistingWordDays,
  PENDING_DIR,
  pendingPath,
  wordsPath,
  type PendingDayFile,
} from "./lib/pending.ts";
import { BuildError, validateWordFile, type RawDay } from "./lib/validate-words.ts";

interface FrequencyFile {
  words: { surface: string }[];
}

async function loadFrequencySurfaces(): Promise<string[]> {
  const raw = await readFile(FREQUENCY_PATH, "utf8");
  return (JSON.parse(raw) as FrequencyFile).words.map((w) => w.surface);
}

export interface CrossCheckArgs {
  date: string | null;
  judge: string;
  promote: boolean;
}

export function parseArgs(argv: readonly string[]): CrossCheckArgs {
  const args: CrossCheckArgs = { date: null, judge: "stub", promote: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--date":
        args.date = argv[++i];
        break;
      case "--judge":
        args.judge = argv[++i];
        break;
      case "--promote":
        args.promote = true;
        break;
      default:
        throw new Error(`未知的參數：${arg}`);
    }
  }
  return args;
}

async function listPendingDates(): Promise<string[]> {
  let filenames: string[];
  try {
    filenames = await readdir(PENDING_DIR);
  } catch {
    return [];
  }
  return filenames.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
}

/** Re-check one pending day: re-validate, re-judge (a fresh, reason-blind pass -- §9.3), write the pending file back, and optionally promote. Returns true iff the day ended up fully verified (whether or not --promote was requested). */
export async function crossCheckOne(
  date: string,
  judgeSpec: string,
  ctx: ReturnType<typeof buildWordCtx>,
  promote: boolean,
  existingExamples: readonly string[],
  loaders: AiLoaders = {},
): Promise<boolean> {
  const raw = await readFile(pendingPath(date), "utf8");
  const pending = JSON.parse(raw) as PendingDayFile;
  const daySeed: DaySeed = { date: pending.date, words: pending.words };

  try {
    validateWordFile(`${date}.json`, daySeed, ctx);
  } catch (err) {
    if (err instanceof BuildError) {
      console.error(`[cross-check] ${date} 驗證失敗：${err.message}`);
      return false;
    }
    throw err;
  }

  const judge = await resolveJudge(judgeSpec, loaders);
  const judgments: Record<string, JudgeResult> = {};
  for (const w of daySeed.words) {
    const req: JudgeRequest = {
      surface: w.surface,
      reading: w.reading,
      gloss: w.gloss,
      example: w.example,
      existing_examples: [...existingExamples],
    };
    judgments[w.id] = await judge.judge(req);
  }

  const judgedWords: WordSeed[] = applyJudgments(daySeed.words, judgments);
  const updatedPending: PendingDayFile = {
    date: pending.date,
    words: judgedWords,
    pipeline: { ...pending.pipeline, judge: judge.name, generated_at: new Date().toISOString(), judgments },
  };
  await writeFile(pendingPath(date), JSON.stringify(updatedPending, null, 2) + "\n", "utf8");

  console.log(`[cross-check] ${date}：judge=${judge.name}`);
  for (const w of judgedWords) {
    const issues = judgments[w.id]?.issues ?? [];
    console.log(`  ${w.id}\t${w.surface}\t${w.verified ? "verified" : `未通過${issues.length ? "：" + issues.join("；") : ""}`}`);
  }

  const ok = canPromote(judgedWords);
  if (promote) {
    if (!ok) {
      console.error(`[cross-check] ${date} 無法 promote：尚有詞未通過 judge，pending 保留`);
    } else if (await fileExists(wordsPath(date))) {
      // Same guard as generate-daily.ts's review-item-1 check: never let a
      // promote step overwrite an already-published day, no matter which
      // script is doing the promoting.
      console.error(`[cross-check] 拒絕 promote：${wordsPath(date)} 已存在（該日期已有正式資料），pending 保留`);
    } else {
      await writeFile(wordsPath(date), JSON.stringify({ date: pending.date, words: judgedWords }, null, 2) + "\n", "utf8");
      await rm(pendingPath(date));
      console.log(`[cross-check] 已 promote：${wordsPath(date)}`);
    }
  }
  return ok;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dates = args.date ? [args.date] : await listPendingDates();

  if (dates.length === 0) {
    console.log("[cross-check] data/pending/ 沒有待處理的檔案");
    return;
  }

  const existingDays: RawDay[] = await loadExistingWordDays();
  const freqSurfaces = await loadFrequencySurfaces();
  const ctx = buildWordCtx(existingDays, freqSurfaces);
  const existingExamples = collectExistingExampleJa(existingDays);

  let anyFailed = false;
  for (const date of dates) {
    const ok = await crossCheckOne(date, args.judge, ctx, args.promote, existingExamples);
    if (!ok) anyFailed = true;
  }

  if (anyFailed) process.exit(1);
}

// CLI guard: only run when this file is the process entry point.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
