// scripts/cross-check.ts — build task 2026-09 step 6, DESIGN.md §9.1 "cross-check.ts
// （二次 AI，不看第一次理由）". Re-runs the judge step (generate-daily.ts's
// step 5) against whatever is currently sitting in data/pending/*.json --
// meant for after a human has hand-edited a pending day (§6.2/§9.4: pending
// content is reviewed in Obsidian/an editor, not blindly trusted), or for
// re-judging with a different backend than the one that originally produced
// the candidate. Also re-runs program validation first (§9.2), since a hand
// edit can just as easily break `example.ja`/tokens agreement as an AI can.
//
// Code review item 1 (P0) added a third job: if the pending file's own
// `pipeline.errors` is non-empty (generate-daily.ts couldn't enrich or
// judge every word and left the failures recorded there instead of losing
// the whole batch), retry exactly those words before doing anything else --
// "重新 enrich 缺的，保留已有的". See crossCheckOne's own doc comment for
// the retry design (enricher selection, when full-file validation is
// skipped, and how promotion is still gated).
//
// Run directly with Node's native TypeScript support, same as build-bank.ts
// / generate-daily.ts -- every relative import needs an explicit ".ts"
// extension for the same reason (see build-bank.ts's header comment).
//
// This file must never import the OpenRouter provider module (under
// scripts/lib/ai/) directly, not even its path as a string --
// scripts/lib/ai/__tests__/no-sdk-on-stub-path.test.ts asserts this file
// never mentions that module's path at all. Both the OpenRouter model
// preflight (item 2) and the enricher retry (item 1) below reach it only
// indirectly, through generate-daily.ts's own gated dynamic imports
// (runOpenRouterPreflightIfNeeded/resolveEnricher), exactly like
// resolveJudge already did before this change.
//
// CLI:
//   --date YYYY-MM-DD   re-check only this pending day (default: every file in data/pending/)
//   --judge NAME        stub | file:<path> | claude | openrouter   (default: stub)
//   --enricher NAME     stub | file:<path> | claude | openrouter   (default: none -- see
//                        crossCheckOne's doc comment for how the retry enricher is picked
//                        when this isn't passed)
//   --model ID          model id override for the openrouter judge/enricher (falls back to
//                        OPENROUTER_MODEL env var, then a built-in default); ignored by
//                        stub/file/claude
//   --promote           promote each day that ends up fully verified

import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { DaySeed, WordSeed } from "../src/lib/bank/types.ts";
import type { EnrichRequest } from "./lib/ai/enricher.ts";
import { AiProviderError } from "./lib/ai/errors.ts";
import {
  applyJudgments,
  assembleSeed,
  canPromote,
  judgeWords,
  printErrorSummary,
  resolveEnricher,
  resolveJudge,
  runOpenRouterPreflightIfNeeded,
  type AiLoaders,
} from "./generate-daily.ts";
import {
  buildWordCtx,
  collectExistingExampleJa,
  collectExistingExampleSurfaces,
  fileExists,
  FREQUENCY_PATH,
  loadExistingWordDays,
  PENDING_DIR,
  pendingPath,
  wordsPath,
  type PendingDayFile,
  type PipelineErrorEntry,
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
  /** Code review item 1: explicit --enricher override for the retry pass. undefined (not passed) means "prefer the pending file's own pipeline.enricher, fall back to stub" -- see crossCheckOne. */
  enricher: string | undefined;
  model: string | undefined;
  promote: boolean;
}

export function parseArgs(argv: readonly string[]): CrossCheckArgs {
  const args: CrossCheckArgs = { date: null, judge: "stub", enricher: undefined, model: undefined, promote: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--date":
        args.date = argv[++i];
        break;
      case "--judge":
        args.judge = argv[++i];
        break;
      case "--enricher":
        args.enricher = argv[++i];
        break;
      case "--model":
        args.model = argv[++i];
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

/**
 * Re-check one pending day:
 *
 * 1. (Code review item 1, P0) If `pending.pipeline.errors` is non-empty --
 *    generate-daily.ts couldn't enrich (or judge) every word and recorded
 *    the failures instead of losing the whole batch -- retry enrichment for
 *    exactly those words first. Words that succeed are removed from
 *    `errors` and added to the word list; words that still fail stay in
 *    `errors` (updated with the new failure). Enricher selection (a design
 *    call, since the review left this under-specified): an explicit
 *    `enricherSpec` (--enricher) wins; otherwise the pending file's own
 *    `pipeline.enricher` is reused (retry with whatever produced the
 *    original candidates); otherwise "stub". `pipeline.enricher` is always
 *    a valid --enricher-style spec string already (it's literally
 *    `Enricher.name`, e.g. "stub" / "file:<path>" / "claude" / "openrouter"),
 *    so this basically always resolves without needing a fallback.
 * 2. Re-validate the whole day (validateWordFile) -- but ONLY when there
 *    are no remaining errors. A day with missing words can never pass
 *    validateWordFile's exact-WORDS_PER_DAY-count check anyway, and running
 *    it anyway would block judging the words that DO exist yet. Skipping
 *    it here doesn't weaken anything promotion-relevant, since promotion
 *    still requires canPromote (which itself requires the full count) AND
 *    zero remaining errors below.
 * 3. Re-judge every word that has no error (judgeWords, shared with
 *    generate-daily.ts's own judge phase so a mid-batch judge()
 *    AiProviderError is handled identically in both scripts). A word whose
 *    judge() call fails here is added to `errors` too (it already has an
 *    id/surface/etc, being an already-enriched word).
 * 4. Write the pending file back with the updated words/errors/judgments.
 * 5. Promotion (canPromote) refuses if `errors.length > 0` after all of the
 *    above, same as before -- checked explicitly rather than only relying
 *    on canPromote's own word-count check, so this stays correct even if
 *    that check's implementation ever changes.
 *
 * Returns true iff the day ended up fully verified AND has no remaining
 * errors (whether or not --promote was requested).
 */
export async function crossCheckOne(
  date: string,
  judgeSpec: string,
  ctx: ReturnType<typeof buildWordCtx>,
  promote: boolean,
  existingExamples: readonly string[],
  loaders: AiLoaders = {},
  model?: string,
  enricherSpec?: string,
  existingSurfaces: readonly string[] = [],
): Promise<boolean> {
  const raw = await readFile(pendingPath(date), "utf8");
  const pending = JSON.parse(raw) as PendingDayFile;

  let words: WordSeed[] = [...pending.words];
  const allErrors: PipelineErrorEntry[] = pending.pipeline.errors ?? [];

  // Bug fix (found by an independent verification pass, then tightened by a
  // second pass on the first fix): an "enrich"-stage failure means the word
  // never made it into `words` at all -- retrying it means re-enriching
  // from scratch and APPENDING. A "judge"-stage failure means enrich()
  // already succeeded, so the word is ALREADY in `words` (applyJudgments
  // keeps every word; a missing/failed judgment just leaves it
  // `verified: false`) -- it does NOT need re-enriching, it needs
  // re-judging, which the unconditional judgeWords() call further below
  // already does for every word in `words` (this one included). Treating
  // every `errors` entry the same and re-enriching+appending regardless of
  // which stage it came from silently duplicated judge-stage words (11
  // words for a 10-word day), which then failed validateWordFile's count
  // check with a misleading message and left the day stuck retrying
  // forever.
  //
  // This is deliberately a STRUCTURAL check (is this error's word id
  // already present in `pending.words`?) rather than trusting the `stage`
  // field on the error entry itself: `stage` is optional (a hand-edited or
  // pre-this-field pending file may not have it at all), and the first
  // version of this fix defaulted a missing `stage` to "enrich" -- which is
  // wrong whenever the untagged entry actually came from a judge-stage
  // failure, silently reproducing the exact same P0 bug for that one edge
  // case. Checking actual membership in `words` can't be wrong the same
  // way: it asks the one fact that actually determines whether re-enriching
  // is needed, instead of inferring it from a field that might not be
  // there. `stage` is kept on PipelineErrorEntry purely as human-readable
  // context (see pending.ts) -- it's never load-bearing for this decision.
  const existingWordIds = new Set(pending.words.map((w) => w.id));
  const enrichStageErrors = allErrors.filter((e) => !existingWordIds.has(e.id));
  const resolvedEnricherSpec = enrichStageErrors.length > 0 ? (enricherSpec ?? pending.pipeline.enricher ?? "stub") : undefined;

  // Item 2 (P0): confirm the OpenRouter model exists before any per-word
  // call below (enrich retry OR judge) -- a no-op unless the judge or the
  // retry enricher actually resolves to "openrouter".
  await runOpenRouterPreflightIfNeeded(
    [judgeSpec, ...(resolvedEnricherSpec ? [resolvedEnricherSpec] : [])],
    model,
    loaders,
  );

  // Only errors whose word id is NOT already in `words` (enrichStageErrors,
  // per the structural check above) are retried here. Errors for a word
  // that's already in `words` are deliberately NOT carried into `errors`
  // below -- that word is already valid and sitting in `words`, so the
  // judge pass further down re-attempts it naturally as part of judging
  // every word in `words`; if that fails again, judgeWords() re-adds it on
  // its own. Carrying it forward here too would double it up once
  // judgeWords runs.
  let errors: PipelineErrorEntry[] = [];

  if (enrichStageErrors.length > 0 && resolvedEnricherSpec) {
    const enricher = await resolveEnricher(resolvedEnricherSpec, loaders, model);
    const stillFailing: PipelineErrorEntry[] = [];
    const recovered: WordSeed[] = [];
    for (const e of enrichStageErrors) {
      const req: EnrichRequest = {
        surface: e.surface,
        reading: e.reading,
        gloss: e.gloss,
        pos: e.pos,
        level: e.level,
        existing_surfaces: [...existingSurfaces],
      };
      try {
        const enriched = await enricher.enrich(req);
        recovered.push(assembleSeed({ rank: e.freq_rank, surface: e.surface, reading: e.reading, gloss: e.gloss, pos: e.pos }, enriched, e.id));
      } catch (err) {
        if (err instanceof AiProviderError) {
          console.error(`[cross-check] ${e.surface}（${e.reading}）重新 enrich 仍失敗（${err.kind}）：${err.detail}`);
          stillFailing.push({ ...e, kind: err.kind, detail: err.detail, stage: "enrich" });
          continue;
        }
        throw err;
      }
    }
    words = [...words, ...recovered];
    errors = stillFailing;
  }

  const daySeed: DaySeed = { date: pending.date, words };

  if (errors.length === 0) {
    try {
      validateWordFile(`${date}.json`, daySeed, ctx);
    } catch (err) {
      if (err instanceof BuildError) {
        console.error(`[cross-check] ${date} 驗證失敗：${err.message}`);
        return false;
      }
      throw err;
    }
  } else {
    console.error(`[cross-check] ${date}：仍有 ${errors.length} 個詞 enrich 失敗，略過整日驗證，僅對已成功的詞繼續複查`);
  }

  const judge = await resolveJudge(judgeSpec, loaders, model);
  const { judgments, errors: judgeErrors } = await judgeWords(words, judge, existingExamples);
  errors = [...errors, ...judgeErrors];

  const judgedWords: WordSeed[] = applyJudgments(words, judgments);
  const updatedPending: PendingDayFile = {
    date: pending.date,
    words: judgedWords,
    pipeline: { ...pending.pipeline, judge: judge.name, generated_at: new Date().toISOString(), judgments, errors },
  };
  await writeFile(pendingPath(date), JSON.stringify(updatedPending, null, 2) + "\n", "utf8");

  console.log(`[cross-check] ${date}：judge=${judge.name}`);
  for (const w of judgedWords) {
    const issues = judgments[w.id]?.issues ?? [];
    console.log(`  ${w.id}\t${w.surface}\t${w.verified ? "verified" : `未通過${issues.length ? "：" + issues.join("；") : ""}`}`);
  }
  if (errors.length > 0) {
    printErrorSummary(date, "enrich/judge", errors, judgedWords.length);
  }

  // Code review item 1: promotion must still refuse if any error remains
  // after the retry pass -- checked explicitly (not only relying on
  // canPromote's word-count check) so this stays correct regardless of how
  // canPromote itself is implemented.
  const ok = canPromote(judgedWords) && errors.length === 0;
  if (promote) {
    if (errors.length > 0) {
      console.error(`[cross-check] ${date} 無法 promote：仍有 ${errors.length} 個詞 enrich/judge 失敗，pending 保留`);
    } else if (!ok) {
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
  const existingSurfaces = collectExistingExampleSurfaces(existingDays);

  let anyFailed = false;
  for (const date of dates) {
    const ok = await crossCheckOne(date, args.judge, ctx, args.promote, existingExamples, {}, args.model, args.enricher, existingSurfaces);
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
