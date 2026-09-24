// scripts/lib/validate-words.ts — word-only validation/enrich logic,
// extracted out of scripts/build-bank.ts (build task 2026-09 step 6, DESIGN.md
// §9.2). build-bank.ts re-exports everything here unchanged (same names,
// same call signatures) so its own existing tests keep passing byte-for-byte
// -- this is a pure refactor, not a behavior change.
//
// This module ALSO grows the API scripts/generate-daily.ts and
// scripts/cross-check.ts need, which build-bank.ts never needed on its own:
// validateWordFile validates a single day's worth of WordSeeds against a
// ctx describing what already exists elsewhere in the bank (for validating
// a data/pending/YYYY-MM-DD.json candidate before it's promoted), and
// validateWordSet is the whole-bank cross-file pass build-bank.ts already
// had under the name `validateBank`.
//
// Every relative import here needs an explicit ".ts" extension (Node's own
// ESM loader, not a bundler, resolves this file -- see build-bank.ts's own
// header comment for why).

import { basename } from "node:path";
import type { ZodError } from "zod";
import { kanaToCells, readingToRomaji, toHiragana } from "../../src/lib/kana/index.ts";
import { POS_VALUES } from "../../src/lib/bank/types.ts";
import { stripExamplePunctuation } from "../../src/lib/bank/text.ts";
import type { DaySeed, ExampleToken, JlptLevel, Word, WordSeed } from "../../src/lib/bank/types.ts";
import { KanaInputError } from "../../src/lib/kana/types.ts";
import type { Mora } from "../../src/lib/kana/types.ts";
import { WordFileSchema, WordSeedSchema } from "./schemas.ts";

/** The two functions this module (and build-bank.ts) need out of src/lib/kana/, narrowed to what's actually called. */
export interface KanaCodec {
  kanaToCells(reading: string, opts?: { particle?: boolean }): Mora[];
  readingToRomaji(reading: string, opts?: { particle?: boolean }): { romaji: string; romaji_ascii: string };
}

/** The real codec, used as the default so callers that don't need to inject a fake one (generate-daily.ts, cross-check.ts) can call `enrichWord(seed)` / `validateWordFile(file, seed, ctx)` without wiring it up themselves. build-bank.ts and its tests still pass one explicitly, for identical behavior to before this file existed. */
export const DEFAULT_CODEC: KanaCodec = { kanaToCells, readingToRomaji };

/** Thrown for any validation failure. Message is always "`${file} / ${id} / ${reason}`" per the build task's spec. */
export class BuildError extends Error {}

export function fail(file: string, id: string, reason: string): never {
  throw new BuildError(`${file} / ${id} / ${reason}`);
}

/** One raw (not-yet-enriched) day file, tagged with the filename it came from (for error messages). */
export interface RawDay {
  file: string;
  seed: DaySeed;
}

const LEVEL_VALUES: readonly JlptLevel[] = ["N5", "N4", "N3", "N2", "N1"];
export const WORDS_PER_DAY = 10;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^w_\d{4,}$/;

/**
 * Every surface allowed to carry `particle: true` on an example token
 * (word examples AND grammar sentence tokens -- both go through this same
 * set, see build-bank.ts's enrichSentenceToken). Extended build task
 * 2026-09-24 §A for the ~30-item grammar expansion: より だけ しか ほど さえ
 * ので けど し ね よ なんて とは ばかり. `たら` is deliberately NOT added here --
 * it's never its own token (「行ったら」is one verb token, see items.json's
 * own `note` on why); see the build task's report for the reasoning.
 */
export const PARTICLE_SURFACES = new Set([
  "は", "が", "を", "に", "で", "と", "の", "も", "へ",
  "か", "から", "まで", "や", "ね", "よ", "でも", "には", "では", "とか",
  "より", "だけ", "しか", "ほど", "さえ", "ので", "けど", "し", "なんて", "とは", "ばかり",
]);
/** Surfaces that are, on their own as a whole token, almost never anything BUT a particle. */
export const ALWAYS_PARTICLE_SURFACES = new Set(["は", "を", "へ", "が"]);

/** Every CJK ideograph (kanji) character in `text` (review item 5(a)). Deliberately a plain Unicode range check, not a dictionary lookup -- kanji.json/frequency table membership is a SURFACE-level concept, this is character-level so a conjugated form (食べます vs 食べる) still finds its kanji via any surface that contains it. */
const KANJI_RE = /[一-鿿㐀-䶿]/gu;
export function extractKanji(text: string): Set<string> {
  const set = new Set<string>();
  for (const m of text.matchAll(KANJI_RE)) set.add(m[0]);
  return set;
}

/** Union of extractKanji() over every string in `surfaces` -- the "known/in-scope" kanji set a caller builds from the frequency table plus every existing word's own surface (review item 5(a)). */
export function buildKnownKanji(surfaces: Iterable<string>): Set<string> {
  const set = new Set<string>();
  for (const s of surfaces) for (const ch of extractKanji(s)) set.add(ch);
  return set;
}

/**
 * 2026-09-18 P2 fix: the single shared message text for "this example
 * token's surface contains a kanji outside the known-kanji set" -- used by
 * BOTH checkExampleKanjiScope below (validateWordFile/validateWordSet's
 * per-day pass, which throws on this via fail()) and
 * collectExampleTokenProblems further down (validateWordStandalone's
 * per-token pass, which collects it instead of throwing). Before this fix
 * the two had two independently-written copies of this message that had
 * drifted apart in wording/word-order -- a caller printing both a
 * validateWordFile BuildError and a validateWordStandalone problem for the
 * exact same underlying mistake would see two DIFFERENT sentences for it.
 * This is the OLDER of the two wordings, kept as-is on purpose:
 * validate-words.test.ts's "例句超綱漢字" describe block pins
 * checkExampleKanjiScope's message verbatim (`/例句含超綱漢字：[学校]/` etc),
 * and that test is explicitly off-limits to change (build task's own "不要
 * 改 validateWordFile / build-bank 既有行為與錯誤訊息" rule) -- so
 * collectExampleTokenProblems switched TO this wording, not the reverse.
 */
function kanjiScopeProblem(tokenIndex: number, kanjiChar: string, tokenSurface: string): string {
  return `例句含超綱漢字：${kanjiChar}（example.tokens[${tokenIndex}] "${tokenSurface}"）`;
}

/**
 * Review item 5(a): every kanji character appearing in a non-particle
 * example token's surface must already be "in scope" -- present somewhere
 * in the frequency table or an existing word's own surface. Particle
 * tokens are skipped (は/を/に/... never introduce a new kanji, and mixing
 * them into this check would be pointless). Checks by character, not by
 * exact word match, so a conjugated form (食べます) is fine as long as its
 * kanji (食) shows up SOMEWHERE in scope (e.g. via 食べる itself).
 */
function checkExampleKanjiScope(file: string, word: { id: string; example: WordSeed["example"] }, knownKanji: ReadonlySet<string>): void {
  for (const [i, token] of word.example.tokens.entries()) {
    if (token.particle) continue;
    for (const ch of extractKanji(token.surface)) {
      if (!knownKanji.has(ch)) {
        fail(file, word.id, kanjiScopeProblem(i, ch, token.surface));
      }
    }
  }
}

/**
 * Runs `seed` through WordFileSchema.safeParse and, on failure, converts
 * the first zod issue into a BuildError with the same "`${file} / ${id} /
 * ${reason}`" shape every other check in this module uses (review item 3:
 * "第一步先 safeParse，失敗轉成 BuildError（含 file/id/欄位路徑）"). This
 * catches shape problems -- a missing `example`, `collocations` sent as a
 * string, a token missing `reading` -- as a clear BuildError instead of a
 * TypeError three functions later inside enrichWord.
 */
function validateDayFileSchema(file: string, seed: unknown): void {
  const result = WordFileSchema.safeParse(seed);
  if (result.success) return;

  const issue = (result.error as ZodError).issues[0];
  const path = issue.path;
  // path looks like ["words", 3, "example", "tokens", 0, "reading"] for a
  // problem inside words[3] -- resolve that word's own id (if the object at
  // that index even has one) so the error points at a specific word instead
  // of just "the file".
  let id = "-";
  if (path[0] === "words" && typeof path[1] === "number") {
    const maybeWords = (seed as { words?: unknown }).words;
    const word = Array.isArray(maybeWords) ? (maybeWords[path[1]] as { id?: unknown } | undefined) : undefined;
    if (word && typeof word.id === "string") id = word.id;
  }
  const pathStr = path.join(".") || "(root)";
  fail(file, id, `schema 驗證失敗：${pathStr} - ${issue.message}`);
}

/** KanaInputError.reason -> the Chinese label build-bank puts in front of its own error message. */
export function kanaInputErrorLabel(err: unknown): string {
  if (err instanceof KanaInputError && err.reason === "orphan-small") {
    return "小字沒有可依附的前一拍";
  }
  return "含非假名字元";
}

/** The text of the first out-of-table mora in `morae` (ゐ/ゑ/ゕ/ゖ/踊り字...), or undefined if
 *  none. kanaToCells doesn't throw for these -- it just marks them `out_of_table` -- so callers
 *  that need to reject them (every authored reading in this bank) must check explicitly. */
export function findOutOfTable(morae: Mora[]): string | undefined {
  return morae.find((m) => m.marks.includes("out_of_table"))?.text;
}

/** Run one example token through the codec, tagged with its own `particle` flag (§7 override). */
export function enrichExampleToken(
  token: ExampleToken,
  index: number,
  file: string,
  id: string,
  codec: KanaCodec,
) {
  if (token.particle && !PARTICLE_SURFACES.has(token.surface)) {
    fail(
      file,
      id,
      `example.tokens[${index}] 標了 particle:true 但 surface "${token.surface}" 不在助詞白名單內`,
    );
  }
  if (!token.particle && ALWAYS_PARTICLE_SURFACES.has(token.surface)) {
    fail(
      file,
      id,
      `example.tokens[${index}] surface "${token.surface}" 幾乎必為助詞，但未標 particle:true`,
    );
  }

  let morae: Mora[];
  try {
    morae = codec.kanaToCells(token.reading, { particle: token.particle });
  } catch (err) {
    fail(file, id, `example.tokens[${index}].reading ${kanaInputErrorLabel(err)}：${(err as Error).message}`);
  }
  const outOfTable = findOutOfTable(morae);
  if (outOfTable) {
    fail(file, id, `example.tokens[${index}].reading 含表外假名：${outOfTable}`);
  }
  const surfaceReadingProblem = surfaceReadingMismatchReason(token.surface, token.reading);
  if (surfaceReadingProblem) {
    fail(file, id, `example.tokens[${index}] ${surfaceReadingProblem}`);
  }

  checkExampleTokenGloss(token, index, file, id);

  const romaji = codec.readingToRomaji(token.reading, { particle: token.particle }).romaji;
  return { ...token, morae, romaji };
}

/** A token surface with no kanji at all: only kana, ー and punctuation. */
const KANA_ONLY_SURFACE_RE = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u;

/**
 * Punctuation and quote marks removed from BOTH surface and reading before
 * they're compared: every Unicode punctuation char (「」『』（）、。！？・ …)
 * plus the ASCII punctuation/symbol ranges. ー is a letter (Lm), not
 * punctuation, so it's kept. This is what lets a quoted token such as
 * grammar-seed s_g018's 「ありがとう」 / ありがとう pass.
 */
const SURFACE_READING_PUNCT_RE = /[\p{P}!-\/:-@\[-`{-~]/gu;

/**
 * For a kana-only surface (no kanji), the reading must be the SAME kana --
 * katakana vs hiragana doesn't matter (トイレ/トイレ and トイレ/といれ both
 * pass, compared via toHiragana). Catches a particle whose reading was
 * written as its pronunciation (へ/え, は/わ, を/お): kanaToCells would then
 * light the え/わ/お cell instead of the へ/は/を one the learner actually
 * sees -- teaching the wrong character. Returns the reason text (without the
 * "example.tokens[i]" / "tokens[i]" prefix, which differs between words and
 * sentences), or null when fine / not applicable. Shared with build-bank.ts's
 * sentence-token check.
 */
export function surfaceReadingMismatchReason(surface: string, reading: string): string | null {
  const bareSurface = surface.replace(SURFACE_READING_PUNCT_RE, "");
  if (bareSurface === "" || !KANA_ONLY_SURFACE_RE.test(bareSurface)) return null;
  const bareReading = reading.replace(SURFACE_READING_PUNCT_RE, "");
  if (toHiragana(bareSurface) === toHiragana(bareReading)) return null;
  return `surface "${surface}" 與 reading "${reading}" 不一致：純假名 surface 的 reading 必須是同一組假名（平/片假名視為相同）；助詞 は/へ/を 的 reading 寫字形本身（は/へ/を），發音由 particle:true 處理`;
}

/**
 * Hiragana + katakana (U+3040–U+30FF) EXCEPT the katakana middle dot ・
 * (U+30FB), which is punctuation. The prolonged-sound mark ー (U+30FC) IS
 * rejected -- it only ever shows up in a gloss as part of a pasted reading.
 */
const GLOSS_KANA_RE = /[぀-ヺー-ヿ]/u;

/**
 * Example-token gloss rules (DESIGN.md §9.2): every token must carry a
 * non-blank `gloss`, and that gloss must not contain kana -- a kana gloss is
 * almost always the model pasting the READING in where the MEANING belongs
 * (e.g. "たべる" for 食べます). Chinese punctuation/brackets such as the
 * particle convention "（主題）" are fine. Runs here (inside enrichWord's
 * per-token pass) rather than only in the zod schema so build-bank.ts --
 * which never runs WordFileSchema -- still fails loud on a hand-edited file.
 */
function checkExampleTokenGloss(token: ExampleToken, index: number, file: string, id: string): void {
  const gloss: unknown = (token as { gloss?: unknown }).gloss;
  if (typeof gloss !== "string" || gloss.trim() === "") {
    fail(file, id, `example.tokens[${index}] "${token.surface}" 缺少 gloss（或為空字串）`);
  }
  const kana = GLOSS_KANA_RE.exec(gloss);
  if (kana) {
    fail(file, id, `example.tokens[${index}] "${token.surface}" 的 gloss 含假名「${kana[0]}」（gloss 應是中文意思，不是讀音）：${gloss}`);
  }
}

/**
 * Compute every derived field for one seed word: morae/romaji/romaji_ascii
 * from `reading`, and each example token's own morae/romaji (§ token
 * schema: particles are their own token, tagged `particle: true`, so は/へ/を
 * read correctly and an unrelated word-boundary vowel never gets merged
 * into a long vowel it isn't). Also checks everything about this one word
 * that doesn't require looking at the rest of the bank. Throws BuildError
 * on the first problem found.
 *
 * `file` and `codec` default so a validation-only caller (generate-daily.ts)
 * can write `enrichWord(seed)`; build-bank.ts and its tests keep passing
 * both explicitly, unchanged from before this file existed.
 */
export function enrichWord(seed: WordSeed, file = "-", codec: KanaCodec = DEFAULT_CODEC): Word {
  if (!ID_RE.test(seed.id)) fail(file, seed.id, `id 格式須為 w_ 加四位數：${seed.id}`);
  if (!POS_VALUES.includes(seed.pos)) fail(file, seed.id, `pos 不在枚舉內：${seed.pos}`);
  if (!LEVEL_VALUES.includes(seed.level)) fail(file, seed.id, `level 不在 N5–N1 內：${seed.level}`);
  if (typeof seed.verified !== "boolean") fail(file, seed.id, "verified 必須是 boolean");

  let morae: Mora[];
  try {
    morae = codec.kanaToCells(seed.reading);
  } catch (err) {
    fail(file, seed.id, `reading ${kanaInputErrorLabel(err)}：${(err as Error).message}`);
  }
  const outOfTable = findOutOfTable(morae);
  if (outOfTable) {
    fail(file, seed.id, `reading 含表外假名：${outOfTable}`);
  }

  const strippedJa = stripExamplePunctuation(seed.example.ja);
  const tokenSurfaces = seed.example.tokens.map((t) => t.surface).join("");
  if (strippedJa !== tokenSurfaces) {
    fail(
      file,
      seed.id,
      `example.ja 與 tokens 串接不一致：去標點後 "${strippedJa}" ≠ tokens 串接 "${tokenSurfaces}"`,
    );
  }

  const builtTokens = seed.example.tokens.map((t, i) => enrichExampleToken(t, i, file, seed.id, codec));

  const derived = codec.readingToRomaji(seed.reading);

  return {
    ...seed,
    morae,
    romaji: seed.romaji_override ?? derived.romaji,
    romaji_ascii: derived.romaji_ascii,
    example: {
      ja: seed.example.ja,
      zh: seed.example.zh,
      tokens: builtTokens,
      romaji: builtTokens.map((t) => t.romaji).join(" "),
    },
  };
}

/**
 * Checks that need the whole bank at once, run BEFORE enrichWord touches
 * any of it: filename/date agreement, exactly 10 words per day, id
 * uniqueness, surface+reading uniqueness, freq_rank (strictly increasing
 * within a day, unique across the whole bank), and confusable_with
 * symmetry (A lists B => B must list A, wherever B actually lives). Throws
 * BuildError on the first problem found.
 *
 * This is byte-for-byte the old build-bank.ts `validateBank` -- build-bank.ts
 * re-exports it under that name for its existing tests.
 */
export interface ValidateWordSetOpts {
  /**
   * When given, turns on the two content checks from review item 5:
   * (a) no example token (other than a particle token) may introduce a
   * kanji character outside this set, and (b) every word's example.ja must
   * be unique across the whole set passed in. Optional and off-by-default
   * SPECIFICALLY so every pre-existing caller/test of validateWordSet (most
   * of which use placeholder surfaces/examples that were never meant to
   * pass a real vocabulary-scope check) keeps behaving exactly as before --
   * scripts/build-bank.ts's own real invocation always passes this.
   */
  knownKanji?: ReadonlySet<string>;
}

export function validateWordSet(days: RawDay[], opts: ValidateWordSetOpts = {}): void {
  const seenIds = new Map<string, string>(); // id -> file
  const seenSurfaceReading = new Map<string, string>(); // "surface|reading" -> file
  const seenFreqRanks = new Map<number, string>(); // freq_rank -> file
  const confusableById = new Map<string, { file: string; list: string[] }>();
  const seenJa = new Map<string, string>(); // example.ja -> id, only used when opts.knownKanji is given

  for (const { file, seed } of days) {
    const expectedDate = basename(file, ".json");
    if (!DATE_RE.test(expectedDate)) fail(file, "-", "檔名須為 YYYY-MM-DD.json");
    if (seed.date !== expectedDate) {
      fail(file, "-", `date 欄位 (${seed.date}) 與檔名 (${expectedDate}) 不符`);
    }
    if (seed.words.length !== WORDS_PER_DAY) {
      fail(file, "-", `恰須 ${WORDS_PER_DAY} 詞，實際 ${seed.words.length}`);
    }

    let prevFreqRank = -Infinity;
    for (const word of seed.words) {
      const prevIdFile = seenIds.get(word.id);
      if (prevIdFile) fail(file, word.id, `id 與 ${prevIdFile} 重複`);
      seenIds.set(word.id, file);

      const key = `${word.surface}|${word.reading}`;
      const prevSrFile = seenSurfaceReading.get(key);
      if (prevSrFile) fail(file, word.id, `surface+reading 與 ${prevSrFile} 重複`);
      seenSurfaceReading.set(key, file);

      if (word.freq_rank <= prevFreqRank) {
        fail(file, word.id, `freq_rank (${word.freq_rank}) 未嚴格遞增於前一詞 (${prevFreqRank})`);
      }
      prevFreqRank = word.freq_rank;

      const prevRankFile = seenFreqRanks.get(word.freq_rank);
      if (prevRankFile) fail(file, word.id, `freq_rank ${word.freq_rank} 與 ${prevRankFile} 重複`);
      seenFreqRanks.set(word.freq_rank, file);

      confusableById.set(word.id, { file, list: word.confusable_with });

      if (opts.knownKanji) {
        checkExampleKanjiScope(file, word, opts.knownKanji);
        const prevJaId = seenJa.get(word.example.ja);
        if (prevJaId) fail(file, word.id, `例句與 ${prevJaId} 重複`);
        seenJa.set(word.example.ja, word.id);
      }
    }
  }

  // Symmetry needs every id known first (confusable_with can point forward
  // to a word in a later day file), so it runs as its own pass afterward.
  for (const [id, { file, list }] of confusableById) {
    for (const otherId of list) {
      const other = confusableById.get(otherId);
      if (!other) continue; // unknown id -- out of scope for this check
      if (!other.list.includes(id)) {
        fail(file, id, `confusable_with 不對稱：${id} 列了 ${otherId}，但 ${otherId} 沒有回指 ${id}`);
      }
    }
  }
}

/** Back-compat alias for the pre-refactor name build-bank.ts's own tests import. */
export const validateBank = validateWordSet;

// ---------------------------------------------------------------------------
// New API for scripts/generate-daily.ts / scripts/cross-check.ts (build task
// 2026-09 step 6): validate ONE day file's worth of WordSeeds against
// whatever already exists elsewhere in the bank, without needing every other
// data/words/*.json file loaded (validateWordSet needs the whole set at
// once; a pending candidate file needs to be checked against the *existing*
// bank instead).

/** What validateWordFile needs to know about words that live outside the file it's checking. */
export interface WordValidationCtx {
  /** ids already used anywhere in data/words/*.json. */
  existingIds: ReadonlySet<string>;
  /** "surface|reading" keys already used anywhere in data/words/*.json. */
  existingSurfaceReading: ReadonlySet<string>;
  /** freq_rank values already used anywhere in data/words/*.json. */
  existingFreqRanks: ReadonlySet<number>;
  /** Every known word id, for confusable_with existence checks (symmetry itself still can't be fully checked against a pending file the referenced word hasn't seen yet -- see note below). */
  existingConfusableWith?: ReadonlyMap<string, readonly string[]>;
  /** Every kanji character "in scope" -- occurs in the frequency table or an existing word's own surface (review item 5(a)). Required, not optional: this check is never meant to be silently skippable from this entry point (build-bank.ts's own validateWordSet call is the only place that opts in/out, for backward compatibility with its pre-existing placeholder-fixture tests -- see ValidateWordSetOpts). */
  knownKanji: ReadonlySet<string>;
  /** Every example.ja text already used anywhere in the existing bank, mapped to the word id that uses it (review item 5(b): example sentences must be unique bank-wide, not just within one day). */
  existingExampleJa: ReadonlyMap<string, string>;
  codec?: KanaCodec;
}

/**
 * Validate + enrich one day file (typically a data/pending/YYYY-MM-DD.json
 * candidate) against `ctx` describing everything that already exists in the
 * bank. Runs the same per-word/per-file checks validateWordSet does, scoped
 * to this one file: filename/date agreement, exactly 10 words, id/
 * surface+reading/freq_rank uniqueness (against `ctx` AND within the file
 * itself), freq_rank strictly increasing within the file, and everything
 * enrichWord itself checks (reading legality, example consistency, particle
 * whitelist). Returns the enriched Words on success (the caller doesn't have
 * to call enrichWord again to see morae/romaji); throws BuildError on the
 * first problem found, matching validateWordSet's message format so the two
 * are indistinguishable from a script's error output.
 *
 * confusable_with symmetry: only checked one direction here (this file's
 * words must not silently break an EXISTING word's already-declared list by
 * pointing at something that doesn't exist) -- full A<->B symmetry against
 * a word that hasn't been promoted yet is meaningless (the promoted word
 * doesn't exist until this file is promoted), so validateWordSet is still
 * the authority for symmetry once everything is merged into the real bank.
 */
export function validateWordFile(file: string, seed: DaySeed, ctx: WordValidationCtx): Word[] {
  // Step 1 (review item 3): shape-check the WHOLE day against the zod
  // schema before anything else touches it. A pending file can come from
  // an AI response or a hand edit -- either can produce something that
  // merely LOOKS like a DaySeed at the type level (this function's own
  // `seed: DaySeed` parameter type is a compile-time promise the caller
  // made, not a runtime guarantee) but is missing a field or has the wrong
  // type deep inside `example`. Catch that here as a clear BuildError
  // instead of a TypeError from inside enrichWord/enrichExampleToken.
  validateDayFileSchema(file, seed);

  const codec = ctx.codec ?? DEFAULT_CODEC;

  const expectedDate = basename(file, ".json");
  if (!DATE_RE.test(expectedDate)) fail(file, "-", "檔名須為 YYYY-MM-DD.json");
  if (seed.date !== expectedDate) {
    fail(file, "-", `date 欄位 (${seed.date}) 與檔名 (${expectedDate}) 不符`);
  }
  if (seed.words.length !== WORDS_PER_DAY) {
    fail(file, "-", `恰須 ${WORDS_PER_DAY} 詞，實際 ${seed.words.length}`);
  }

  const seenIdsInFile = new Set<string>();
  const seenSurfaceReadingInFile = new Set<string>();
  const seenFreqRanksInFile = new Set<number>();
  const seenJaInFile = new Map<string, string>(); // example.ja -> id, within this file
  let prevFreqRank = -Infinity;

  const built: Word[] = [];
  for (const word of seed.words) {
    if (ctx.existingIds.has(word.id) || seenIdsInFile.has(word.id)) {
      fail(file, word.id, `id 與既有 bank 或本檔內其他詞重複`);
    }
    seenIdsInFile.add(word.id);

    const key = `${word.surface}|${word.reading}`;
    if (ctx.existingSurfaceReading.has(key) || seenSurfaceReadingInFile.has(key)) {
      fail(file, word.id, `surface+reading 與既有 bank 或本檔內其他詞重複`);
    }
    seenSurfaceReadingInFile.add(key);

    if (word.freq_rank <= prevFreqRank) {
      fail(file, word.id, `freq_rank (${word.freq_rank}) 未嚴格遞增於前一詞 (${prevFreqRank})`);
    }
    prevFreqRank = word.freq_rank;

    if (ctx.existingFreqRanks.has(word.freq_rank) || seenFreqRanksInFile.has(word.freq_rank)) {
      fail(file, word.id, `freq_rank ${word.freq_rank} 與既有 bank 或本檔內其他詞重複`);
    }
    seenFreqRanksInFile.add(word.freq_rank);

    if (ctx.existingConfusableWith) {
      for (const otherId of word.confusable_with) {
        const otherList = ctx.existingConfusableWith.get(otherId);
        if (otherList && !otherList.includes(word.id) && otherId !== word.id) {
          // otherList is already-published, so it can't retroactively
          // reference an id that didn't exist when it was written -- flag
          // the asymmetry now rather than silently accepting a one-way link.
          fail(file, word.id, `confusable_with 不對稱：${word.id} 列了 ${otherId}，但 ${otherId} 沒有回指 ${word.id}`);
        }
      }
    }

    checkExampleKanjiScope(file, word, ctx.knownKanji);

    const existingJaOwner = ctx.existingExampleJa.get(word.example.ja);
    if (existingJaOwner && existingJaOwner !== word.id) {
      fail(file, word.id, `例句與 ${existingJaOwner} 重複`);
    }
    const inFileJaOwner = seenJaInFile.get(word.example.ja);
    if (inFileJaOwner) {
      fail(file, word.id, `例句與 ${inFileJaOwner} 重複`);
    }
    seenJaInFile.set(word.example.ja, word.id);

    built.push(enrichWord(word, file, codec));
  }

  return built;
}

// ---------------------------------------------------------------------------
// validateWordStandalone (2026-09-17 "卡死" fix, DESIGN.md §9.1 "逐詞重試與
// 替補"): every check above (fail()/BuildError) stops at the FIRST problem
// found in a word -- exactly the design that made the 2026-09-16/17 cron
// failures so hard to recover from (a word with 2-3 real problems only ever
// reported the first one, so a retry that fixed problem #1 would just
// surface problem #2 on the NEXT run, one day at a time). This function
// answers a different question: "list EVERY problem this one word has",
// so a caller (generate-daily.ts's per-word retry loop, cross-check.ts's
// reporting) can hand an AI (or a human) the complete picture in one pass
// instead of a single symptom.
//
// Deliberately does NOT reuse enrichWord/enrichExampleToken/fail() (all of
// which throw on the first problem, by design, and whose exact
// messages/behavior this build task's spec explicitly forbids changing --
// "不要改 validateWordFile / build-bank 既有行為與錯誤訊息"). Every check
// below is a hand-collected sibling of an existing check, written to push a
// message onto an array instead of throwing. This is deliberate
// duplication, not a refactor: enrichWord's throwing behavior stays exactly
// as it always has for build-bank.ts/validateWordFile's callers.
//
// Scope is intentionally narrower than validateWordFile/validateWordSet:
// this checks only what's knowable about ONE word in isolation (its own
// shape, its own reading/example content, and whether its example.ja
// collides with something already known) -- id/surface+reading/freq_rank
// uniqueness and confusable_with symmetry need the WHOLE day/bank at once
// and stay validateWordFile/validateWordSet's job.

/** What validateWordStandalone needs to know about the rest of the bank/batch to check one word in isolation. */
export interface StandaloneWordCtx {
  /** Every kanji character "in scope" (buildKnownKanji's output) -- see checkExampleKanjiScope above. */
  knownKanji: ReadonlySet<string>;
  /** Every example.ja sentence already published in data/words/*.json. */
  existingExampleJa: ReadonlySet<string>;
  /** example.ja -> "surface|reading" (or word id) for every OTHER word already accepted earlier in the same generate-daily run/day, so an intra-batch duplicate is caught before it ever reaches validateWordFile. */
  batchExampleJa: ReadonlyMap<string, string>;
  codec?: KanaCodec;
}

/** Non-throwing sibling of enrichExampleToken's per-token checks (particle whitelist, reading legality, surface/reading agreement, gloss, kanji scope) -- collects every problem instead of stopping at the first. */
function collectExampleTokenProblems(
  token: ExampleToken,
  index: number,
  codec: KanaCodec,
  knownKanji: ReadonlySet<string>,
): string[] {
  const problems: string[] = [];

  if (token.particle && !PARTICLE_SURFACES.has(token.surface)) {
    problems.push(`example.tokens[${index}] 標了 particle:true 但 surface "${token.surface}" 不在助詞白名單內`);
  }
  if (!token.particle && ALWAYS_PARTICLE_SURFACES.has(token.surface)) {
    problems.push(`example.tokens[${index}] surface "${token.surface}" 幾乎必為助詞，但未標 particle:true`);
  }

  let morae: Mora[] | undefined;
  try {
    morae = codec.kanaToCells(token.reading, { particle: token.particle });
  } catch (err) {
    problems.push(`example.tokens[${index}].reading ${kanaInputErrorLabel(err)}：${(err as Error).message}`);
  }
  if (morae) {
    const outOfTable = findOutOfTable(morae);
    if (outOfTable) problems.push(`example.tokens[${index}].reading 含表外假名：${outOfTable}`);
  }

  const mismatch = surfaceReadingMismatchReason(token.surface, token.reading);
  if (mismatch) problems.push(`example.tokens[${index}] ${mismatch}`);

  const gloss: unknown = (token as { gloss?: unknown }).gloss;
  if (typeof gloss !== "string" || gloss.trim() === "") {
    problems.push(`example.tokens[${index}] "${token.surface}" 缺少 gloss（或為空字串）`);
  } else {
    const kana = GLOSS_KANA_RE.exec(gloss);
    if (kana) {
      problems.push(`example.tokens[${index}] "${token.surface}" 的 gloss 含假名「${kana[0]}」（gloss 應是中文意思，不是讀音）：${gloss}`);
    }
  }

  if (!token.particle) {
    for (const ch of extractKanji(token.surface)) {
      if (!knownKanji.has(ch)) {
        problems.push(kanjiScopeProblem(index, ch, token.surface));
      }
    }
  }

  return problems;
}

/**
 * Every problem `word` has, checked in isolation against `ctx` (nothing
 * about the rest of the day/bank beyond what `ctx` supplies). Empty array
 * means the word passes every check this function knows how to run.
 * `fileLabel` is used only to prefix each message the same "`${file} / ${id}
 * / ${reason}`" shape BuildError's message already uses elsewhere in this
 * module, so a caller printing these strings gets output that reads
 * consistently with everything else this pipeline logs.
 *
 * If the zod shape check itself fails, every other check is skipped (there
 * is no reliable `word.example.tokens` to walk if `example` itself is the
 * wrong shape) -- the shape problems are returned alone, exactly like
 * validateWordFile's own "step 1: safeParse first" ordering.
 */
export function validateWordStandalone(word: WordSeed, ctx: StandaloneWordCtx, fileLabel: string): string[] {
  const idForLabel = typeof (word as { id?: unknown })?.id === "string" ? (word as { id: string }).id : "-";
  const prefix = (reason: string) => `${fileLabel} / ${idForLabel} / ${reason}`;

  const shapeResult = WordSeedSchema.safeParse(word);
  if (!shapeResult.success) {
    return shapeResult.error.issues.map((issue) => {
      const pathStr = issue.path.join(".") || "(root)";
      return prefix(`schema 驗證失敗：${pathStr} - ${issue.message}`);
    });
  }

  const codec = ctx.codec ?? DEFAULT_CODEC;
  const problems: string[] = [];

  if (!ID_RE.test(word.id)) problems.push(`id 格式須為 w_ 加四位數：${word.id}`);
  if (!POS_VALUES.includes(word.pos)) problems.push(`pos 不在枚舉內：${word.pos}`);
  if (!LEVEL_VALUES.includes(word.level)) problems.push(`level 不在 N5–N1 內：${word.level}`);
  if (typeof word.verified !== "boolean") problems.push("verified 必須是 boolean");

  let morae: Mora[] | undefined;
  try {
    morae = codec.kanaToCells(word.reading);
  } catch (err) {
    problems.push(`reading ${kanaInputErrorLabel(err)}：${(err as Error).message}`);
  }
  if (morae) {
    const outOfTable = findOutOfTable(morae);
    if (outOfTable) problems.push(`reading 含表外假名：${outOfTable}`);
  }

  const strippedJa = stripExamplePunctuation(word.example.ja);
  const tokenSurfaces = word.example.tokens.map((t) => t.surface).join("");
  if (strippedJa !== tokenSurfaces) {
    problems.push(`example.ja 與 tokens 串接不一致：去標點後 "${strippedJa}" ≠ tokens 串接 "${tokenSurfaces}"`);
  }

  word.example.tokens.forEach((t, i) => {
    problems.push(...collectExampleTokenProblems(t, i, codec, ctx.knownKanji));
  });

  if (ctx.existingExampleJa.has(word.example.ja)) {
    problems.push(`例句與既有 bank 重複：${word.example.ja}`);
  }
  const batchOwner = ctx.batchExampleJa.get(word.example.ja);
  if (batchOwner && batchOwner !== word.id) {
    problems.push(`例句與本批次 ${batchOwner} 重複：${word.example.ja}`);
  }

  return problems.map(prefix);
}
