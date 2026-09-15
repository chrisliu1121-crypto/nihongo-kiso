// scripts/__tests__/cross-check-retry-stage.test.ts — regression test for a
// bug an independent verification pass found in scripts/cross-check.ts's
// pipeline.errors retry logic (itself part of code review item 1, P0).
//
// generate-daily.ts writes a pipeline.errors entry in TWO different
// situations:
//   - an "enrich"-stage failure: enrich() threw, so the word never made it
//     into `words` at all (see enrichCandidates in generate-daily.ts).
//   - a "judge"-stage failure: enrich() succeeded but judge() threw, so the
//     word IS already sitting in `words` (applyJudgments keeps every word;
//     a missing judgment just leaves it verified:false -- see judgeWords).
//
// crossCheckOne's first version treated every pipeline.errors entry as an
// "enrich"-stage failure unconditionally: it re-enriched and APPENDED every
// one of them, regardless of whether the word was already in `words`. For a
// judge-stage failure this silently duplicated the word (11 words for a
// 10-word day), which then failed validateWordFile's exact-count check with
// a misleading "恰須 10 詞，實際 11" message -- and since crossCheckOne
// returns false without writing anything back in that case, the day was
// stuck retrying the exact same false failure forever.
//
// The fix tags each pipeline.errors entry with `stage` ("enrich" | "judge")
// at write time (generate-daily.ts) for human/log context, but -- second
// round of review -- crossCheckOne's retry decision itself is NOT allowed
// to trust that tag: `stage` is optional, and a first version of this fix
// defaulted a missing `stage` to "enrich", which mis-handled an untagged
// judge-stage entry (from a hand-edited or pre-this-field pending file) the
// exact same broken way -- re-enriching and appending a word that was
// already in `words`, reproducing the same 11-words bug for that one edge
// case. The retry decision is now STRUCTURAL: an error entry is only
// re-enriched if its word id is NOT already present in `pending.words`;
// everything else (including any judge-stage entry, tagged or not) is left
// alone for the ordinary (unconditional) judge pass that already runs over
// every word in `words`.
//
// All three tests below build a full 10-word day (validateWordFile requires
// exactly WORDS_PER_DAY=10) using StubEnricher's deterministic, always-valid
// output, and use judge="stub" (StubJudge always returns a clean verdict)
// so the only thing under test is the retry logic itself, not any
// particular Enricher/Judge's content.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EnrichResult } from "../lib/ai/enricher";
import { StubEnricher } from "../lib/ai/stub";
import {
  buildWordCtx,
  pendingPath,
  wordsPath,
  type PendingDayFile,
  type PipelineErrorEntry,
  type PipelineMeta,
} from "../lib/pending";
import { assembleSeed, canPromote, writePending, type FrequencyWord } from "../generate-daily";
import { crossCheckOne } from "../cross-check";

// Dates that will never collide with a real generated day.
const TEST_DATE_JUDGE_STAGE = "1999-02-01";
const TEST_DATE_ENRICH_STAGE = "1999-02-02";
const TEST_DATE_UNTAGGED_JUDGE_STAGE = "1999-02-03";

// 10 distinct, all-kana "words" (so kanji-scope validation is a non-issue)
// with strictly increasing freq_rank and valid POS values -- enough to
// satisfy validateWordFile's whole-day checks (exactly 10, unique id/
// surface+reading/freq_rank, freq_rank strictly increasing).
const FREQ: FrequencyWord[] = [
  { rank: 101, surface: "あなた", reading: "あなた", gloss: "你", pos: "代名詞" },
  { rank: 102, surface: "それ", reading: "それ", gloss: "那個", pos: "代名詞" },
  { rank: 103, surface: "あれ", reading: "あれ", gloss: "那個(遠)", pos: "代名詞" },
  { rank: 104, surface: "ここ", reading: "ここ", gloss: "這裡", pos: "代名詞" },
  { rank: 105, surface: "そこ", reading: "そこ", gloss: "那裡", pos: "代名詞" },
  { rank: 106, surface: "あそこ", reading: "あそこ", gloss: "那裡(遠)", pos: "代名詞" },
  { rank: 107, surface: "みんな", reading: "みんな", gloss: "大家", pos: "名詞" },
  { rank: 108, surface: "とても", reading: "とても", gloss: "非常", pos: "副詞" },
  { rank: 109, surface: "これ", reading: "これ", gloss: "這個", pos: "代名詞" },
  { rank: 110, surface: "どこ", reading: "どこ", gloss: "哪裡", pos: "疑問詞" },
];
const IDS = FREQ.map((_, i) => `w_89${String(i + 1).padStart(2, "0")}`);
const LAST = FREQ.length - 1; // "どこ" / w_8910 -- the word that will carry the pipeline.errors entry

const FREQ_SURFACES = FREQ.map((f) => f.surface);

function cleanup(date: string): void {
  if (existsSync(pendingPath(date))) rmSync(pendingPath(date));
  if (existsSync(wordsPath(date))) rmSync(wordsPath(date));
}

/** Build all 10 WordSeeds via StubEnricher (deterministic, always passes enrichWord's own checks) -- same helper shape assembleSeed's own tests use. */
async function buildTenWords() {
  const words = [];
  for (let i = 0; i < FREQ.length; i++) {
    const enriched = await StubEnricher.enrich({
      surface: FREQ[i].surface,
      reading: FREQ[i].reading,
      gloss: FREQ[i].gloss,
      pos: FREQ[i].pos,
      level: "N5",
      existing_surfaces: [],
    });
    words.push(assembleSeed(FREQ[i], enriched, IDS[i]));
  }
  return words;
}

describe("cross-check.ts pipeline.errors retry: stage-aware (regression -- verification-agent-found bug)", () => {
  beforeEach(() => {
    cleanup(TEST_DATE_JUDGE_STAGE);
    cleanup(TEST_DATE_ENRICH_STAGE);
    cleanup(TEST_DATE_UNTAGGED_JUDGE_STAGE);
  });
  afterEach(() => {
    cleanup(TEST_DATE_JUDGE_STAGE);
    cleanup(TEST_DATE_ENRICH_STAGE);
    cleanup(TEST_DATE_UNTAGGED_JUDGE_STAGE);
  });

  it("judge-stage failure: the word is ALREADY in pending.words -- retry must NOT re-enrich/duplicate it, just let the ordinary judge pass re-judge it", async () => {
    const words = await buildTenWords();
    // Simulate exactly what generate-daily.ts's judgeWords() catch branch
    // writes: the word stays in `words` (verified:false, no judgment yet),
    // AND gets a pipeline.errors entry tagged stage:"judge".
    const judgeStageError: PipelineErrorEntry = {
      id: IDS[LAST],
      surface: FREQ[LAST].surface,
      reading: FREQ[LAST].reading,
      gloss: FREQ[LAST].gloss,
      pos: FREQ[LAST].pos,
      level: "N5",
      freq_rank: FREQ[LAST].rank,
      kind: "network",
      detail: "模擬：judge() 網路逾時",
      stage: "judge",
    };
    const pipeline: PipelineMeta = {
      // Deliberately a bogus, unreadable path: if the bug regresses (every
      // errors entry treated as enrich-stage), crossCheckOne would try to
      // resolveEnricher("file:...") and call .enrich() against a
      // nonexistent file, which throws a plain (non-AiProviderError) fs
      // error that propagates straight out of crossCheckOne uncaught --
      // failing this test loudly instead of silently duplicating the word.
      enricher: "file:/this/path/does/not/exist/should-never-be-read.json",
      judge: "stub",
      generated_at: new Date().toISOString(),
      judgments: {},
      errors: [judgeStageError],
    };
    await writePending(TEST_DATE_JUDGE_STAGE, { date: TEST_DATE_JUDGE_STAGE, words }, pipeline);

    const ctx = buildWordCtx([], FREQ_SURFACES);
    const ok = await crossCheckOne(
      TEST_DATE_JUDGE_STAGE,
      "stub", // judge
      ctx,
      true, // promote
      [], // existingExamples
      {}, // loaders
      undefined, // model
      undefined, // enricherSpec -- NOT passed, so a buggy implementation would fall back to pending.pipeline.enricher (the bogus path) for every errors entry
      [], // existingSurfaces
    );

    expect(ok).toBe(true);

    // The word must appear exactly once -- not duplicated.
    const dokoCount = (word: { surface: string }) => word.surface === "どこ";
    // Promotion succeeded (ok===true, promote:true, no pre-existing words
    // file), so the result lives in data/words/, not data/pending/ anymore.
    expect(existsSync(pendingPath(TEST_DATE_JUDGE_STAGE))).toBe(false);
    expect(existsSync(wordsPath(TEST_DATE_JUDGE_STAGE))).toBe(true);
    const promoted = JSON.parse(readFileSync(wordsPath(TEST_DATE_JUDGE_STAGE), "utf8")) as { words: { surface: string; verified: boolean }[] };
    expect(promoted.words).toHaveLength(10);
    expect(promoted.words.filter(dokoCount)).toHaveLength(1);
    expect(promoted.words.every((w) => w.verified)).toBe(true);
  });

  it("edge case (second review pass): a pending file with NO `stage` field on its errors entry, whose word is already in `words` -- the structural check must still catch it and NOT re-enrich/duplicate", async () => {
    const words = await buildTenWords();
    // Simulates an old pending file written before `stage` existed, or a
    // hand-edited one where a human stripped/never-added it. Deliberately
    // has NO `stage` key at all -- this is exactly the case where the first
    // fix's `e.stage ?? "enrich"` fallback got it wrong (defaulted to
    // "enrich" and re-enriched/duplicated a word that was already present).
    const untaggedError: Omit<PipelineErrorEntry, "stage"> = {
      id: IDS[LAST],
      surface: FREQ[LAST].surface,
      reading: FREQ[LAST].reading,
      gloss: FREQ[LAST].gloss,
      pos: FREQ[LAST].pos,
      level: "N5",
      freq_rank: FREQ[LAST].rank,
      kind: "network",
      detail: "模擬：舊格式 pending 檔案，沒有 stage 欄位",
    };
    const pipeline: PipelineMeta = {
      // Same trap as the tagged judge-stage test: a bogus, unreadable path.
      // If the structural check is bypassed and this entry falls back to
      // being treated as enrich-stage, crossCheckOne will try to read this
      // nonexistent file and crash with an uncaught fs error instead of
      // quietly duplicating the word -- either way, a broken structural
      // check fails this test loudly.
      enricher: "file:/this/path/does/not/exist/should-never-be-read.json",
      judge: "stub",
      generated_at: new Date().toISOString(),
      judgments: {},
      errors: [untaggedError as PipelineErrorEntry], // no `stage` key present in the actual JSON written to disk
    };
    await writePending(TEST_DATE_UNTAGGED_JUDGE_STAGE, { date: TEST_DATE_UNTAGGED_JUDGE_STAGE, words }, pipeline);

    // Confirm the fixture on disk really has no `stage` key (not just
    // `undefined` in memory) -- otherwise this test wouldn't actually cover
    // the "old file predating the field" scenario.
    const rawOnDisk = JSON.parse(readFileSync(pendingPath(TEST_DATE_UNTAGGED_JUDGE_STAGE), "utf8")) as PendingDayFile;
    expect(Object.prototype.hasOwnProperty.call(rawOnDisk.pipeline.errors?.[0] ?? {}, "stage")).toBe(false);

    const ctx = buildWordCtx([], FREQ_SURFACES);
    const ok = await crossCheckOne(
      TEST_DATE_UNTAGGED_JUDGE_STAGE,
      "stub", // judge
      ctx,
      true, // promote
      [], // existingExamples
      {}, // loaders
      undefined, // model
      undefined, // enricherSpec -- not passed, so a broken check would fall back to pending.pipeline.enricher (the bogus path)
      [], // existingSurfaces
    );

    expect(ok).toBe(true);
    expect(existsSync(pendingPath(TEST_DATE_UNTAGGED_JUDGE_STAGE))).toBe(false);
    expect(existsSync(wordsPath(TEST_DATE_UNTAGGED_JUDGE_STAGE))).toBe(true);
    const promoted = JSON.parse(readFileSync(wordsPath(TEST_DATE_UNTAGGED_JUDGE_STAGE), "utf8")) as { words: { surface: string; verified: boolean }[] };
    expect(promoted.words).toHaveLength(10); // NOT 11
    expect(promoted.words.filter((w) => w.surface === "どこ")).toHaveLength(1); // NOT duplicated
    expect(promoted.words.every((w) => w.verified)).toBe(true);
  });

  it("enrich-stage failure (unaffected by the fix -- still retried/appended correctly): the word is MISSING from pending.words, retry must re-enrich and append it, ending at exactly 10 words", async () => {
    const nineWords = (await buildTenWords()).slice(0, LAST); // first 9 only -- "どこ" never got enriched
    const enrichStageError: PipelineErrorEntry = {
      id: IDS[LAST],
      surface: FREQ[LAST].surface,
      reading: FREQ[LAST].reading,
      gloss: FREQ[LAST].gloss,
      pos: FREQ[LAST].pos,
      level: "N5",
      freq_rank: FREQ[LAST].rank,
      kind: "network",
      detail: "模擬：enrich() 網路逾時",
      stage: "enrich",
    };

    // A FileEnricher fixture that DOES have "どこ|どこ" recorded, standing
    // in for a successful retry with a real provider.
    const dir = mkdtempSync(join(tmpdir(), "nk-test-"));
    const fixturePath = join(dir, "fixture.json");
    const fixtureEntry: EnrichResult = { example: { ja: "どこです。", zh: "哪裡。", tokens: [{ surface: "どこ", reading: "どこ", gloss: "哪裡" }, { surface: "です", reading: "です", gloss: "是" }] }, collocations: [], note: null };
    writeFileSync(fixturePath, JSON.stringify({ "どこ|どこ": fixtureEntry }), "utf8");

    const pipeline: PipelineMeta = {
      enricher: "stub",
      judge: "stub",
      generated_at: new Date().toISOString(),
      judgments: {},
      errors: [enrichStageError],
    };
    await writePending(TEST_DATE_ENRICH_STAGE, { date: TEST_DATE_ENRICH_STAGE, words: nineWords }, pipeline);

    const ctx = buildWordCtx([], FREQ_SURFACES);
    const ok = await crossCheckOne(
      TEST_DATE_ENRICH_STAGE,
      "stub", // judge
      ctx,
      true, // promote
      [], // existingExamples
      {}, // loaders
      undefined, // model
      `file:${fixturePath}`, // enricherSpec -- explicit, points at the fixture with "どこ|どこ"
      [], // existingSurfaces
    );

    expect(ok).toBe(true);
    expect(existsSync(pendingPath(TEST_DATE_ENRICH_STAGE))).toBe(false);
    expect(existsSync(wordsPath(TEST_DATE_ENRICH_STAGE))).toBe(true);
    const promoted = JSON.parse(readFileSync(wordsPath(TEST_DATE_ENRICH_STAGE), "utf8")) as { words: { surface: string; verified: boolean }[] };
    expect(promoted.words).toHaveLength(10);
    expect(promoted.words.filter((w) => w.surface === "どこ")).toHaveLength(1);
    expect(promoted.words.every((w) => w.verified)).toBe(true);
  });

  it("canPromote sanity check on the judge-stage scenario's word list shape (10 verified words) -- same invariant crossCheckOne's own `ok` relies on", async () => {
    const words = (await buildTenWords()).map((w) => ({ ...w, verified: true }));
    expect(canPromote(words)).toBe(true);
    expect(canPromote([...words, words[0]])).toBe(false); // 11 words (the exact shape of the bug) must NOT be promotable
  });
});
