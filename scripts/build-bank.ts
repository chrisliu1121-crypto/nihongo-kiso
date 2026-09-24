// scripts/build-bank.ts — builds data/bank.json from the hand-authored day
// files in data/words/*.json (DESIGN.md §4/§8.2, build task 2026-09).
//
// Run directly (`npm run build:bank`, also wired into predev/prebuild in
// package.json) with Node's native TypeScript support -- no ts-node/tsx.
//
// src/lib/kana/ is imported directly below (`from "../src/lib/kana/index.ts"`)
// and actually resolves under plain `node`: its own internal relative
// imports now carry explicit ".ts" extensions and its `data/kana.json`
// import carries `with { type: "json" }` -- both are things Node's own ESM
// loader requires that Vite's bundler resolution didn't. (An earlier
// version of this file routed through `vite`'s `createServer(...).ssrLoadModule`
// to sidestep that instead of touching src/lib/kana/; that workaround is
// gone now that the constraint against editing src/lib/kana/ was lifted.)
//
// Every relative import in *this* file also needs an explicit ".ts"
// extension for the same reason: it's executed directly by `node`, not
// bundled.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { kanaToCells, readingToRomaji } from "../src/lib/kana/index.ts";
import { PARTICLE_CLASS_VALUES, PARTICLE_IDS, PARTICLE_WEIGHT_VALUES } from "../src/lib/bank/types.ts";
import { GRAMMAR_CATEGORY_VALUES, GRAMMAR_WEIGHT_VALUES } from "../src/lib/bank/types.ts";
import { SWAP_VERDICT_VALUES } from "../src/lib/exercise/types.ts";
import type {
  Bank,
  BuiltSentenceToken,
  ContrastSet,
  DayEntry,
  DaySeed,
  GrammarBank,
  GrammarFile,
  GrammarItem,
  Particle,
  ParticleId,
  ParticlesFile,
  Sentence,
  SentenceFile,
  SentenceSeed,
  SentenceToken,
} from "../src/lib/bank/types.ts";
import type { Exercise, ExerciseFile } from "../src/lib/exercise/types.ts";
import type { Mora } from "../src/lib/kana/types.ts";
import kanaData from "../data/kana.json" with { type: "json" };
import { GrammarFileSchema } from "./lib/schemas.ts";
import {
  ALWAYS_PARTICLE_SURFACES,
  BuildError,
  buildKnownKanji,
  fail,
  findOutOfTable,
  kanaInputErrorLabel,
  PARTICLE_SURFACES,
  enrichWord,
  surfaceReadingMismatchReason,
  validateWordSet as validateBank,
  type KanaCodec,
  type RawDay,
} from "./lib/validate-words.ts";

// Word-only validation/enrich logic (enrichWord, validateBank, the particle
// whitelist, KanaCodec, RawDay, BuildError/fail) now lives in
// ./lib/validate-words.ts (build task 2026-09 step 6) -- re-exported below
// unchanged so this file's own existing tests keep passing without
// modification. Sentence/particle/exercise validation stays here: it's out
// of scope for that extraction (DESIGN.md §9.2 doesn't ask for it, and
// generate-daily.ts/cross-check.ts only ever deal in words).
export { BuildError, enrichWord, validateBank, type KanaCodec, type RawDay };

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const WORDS_DIR = join(PROJECT_ROOT, "data", "words");
const SENTENCES_DIR = join(PROJECT_ROOT, "data", "sentences");
const EXERCISES_DIR = join(PROJECT_ROOT, "data", "exercises");
const BANK_PATH = join(PROJECT_ROOT, "data", "bank.json");
const FREQUENCY_PATH = join(PROJECT_ROOT, "data", "frequency", "n5.json");
const GRAMMAR_ITEMS_PATH = join(PROJECT_ROOT, "data", "grammar", "items.json");
const GRAMMAR_CONTRASTS_PATH = join(PROJECT_ROOT, "data", "grammar", "contrasts.json");

/** Every valid 46-cell gojuon-table id, read straight off data/kana.json (includes "n"). Used to validate particles.json's `cell` field. */
const VALID_CELL_IDS = new Set<string>((kanaData as { cells: { id: string }[] }).cells.map((c) => c.id));

/** Predicate-ending suffixes that mark a bunsetsu as the sentence's verb/predicate (build task 2026-09 step 4: "動詞文節永遠最後"). */
const PREDICATE_SUFFIXES = ["ています", "ます", "です", "ません"];

function endsWithPredicate(surface: string): boolean {
  return PREDICATE_SUFFIXES.some((suf) => surface.endsWith(suf));
}

/**
 * Sentence-final particles that may trail the real predicate (build task
 * 2026-09-24 §A: "述語判定順帶改進：句尾的終助詞 token（か ね よ）略過後再判斷").
 * A grammar example sentence may end in one of these (「そうですね」「行きますか」)
 * without that changing which token is actually the predicate for the
 * verb-final check.
 */
const SENTENCE_FINAL_PARTICLE_SURFACES = new Set(["か", "ね", "よ"]);

/** `tokens` with any trailing か/ね/よ tokens removed (build task 2026-09-24 §A). Used only when checking predicate-finality for arrange practice -- never changes the sentence's own stored tokens. */
function trimTrailingFinalParticles(tokens: SentenceToken[]): SentenceToken[] {
  let end = tokens.length;
  while (end > 0 && SENTENCE_FINAL_PARTICLE_SURFACES.has(tokens[end - 1].surface)) end--;
  return tokens.slice(0, end);
}

/** `arr` is exactly a permutation of [0..n-1] -- same length, every index present, no duplicates. */
function isPermutationOf(arr: number[], n: number): boolean {
  if (arr.length !== n) return false;
  const seen = new Set(arr);
  if (seen.size !== n) return false;
  for (let i = 0; i < n; i++) if (!seen.has(i)) return false;
  return true;
}

function sameOrder(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// ---------------------------------------------------------------------------
// Grammar sentences (build task 2026-09 step 4, DESIGN.md §8.3)

/** One raw (not-yet-enriched) sentence, tagged with the filename it came from. */
export interface RawSentence {
  file: string;
  seed: SentenceSeed;
}

/** Run one sentence token through the codec -- same particle-whitelist/reverse-whitelist rules as enrichExampleToken, since it's the same authoring mistake risk (§7, §9.2). */
function enrichSentenceToken(
  token: SentenceToken,
  index: number,
  file: string,
  id: string,
  codec: KanaCodec,
): BuiltSentenceToken {
  if (!token.gloss) {
    fail(file, id, `tokens[${index}] 缺少 gloss`);
  }
  if (token.particle && !PARTICLE_SURFACES.has(token.surface)) {
    fail(file, id, `tokens[${index}] 標了 particle:true 但 surface "${token.surface}" 不在助詞白名單內`);
  }
  if (!token.particle && ALWAYS_PARTICLE_SURFACES.has(token.surface)) {
    fail(file, id, `tokens[${index}] surface "${token.surface}" 幾乎必為助詞，但未標 particle:true`);
  }

  let morae: Mora[];
  try {
    morae = codec.kanaToCells(token.reading, { particle: token.particle });
  } catch (err) {
    fail(file, id, `tokens[${index}].reading ${kanaInputErrorLabel(err)}：${(err as Error).message}`);
  }
  const outOfTable = findOutOfTable(morae);
  if (outOfTable) {
    fail(file, id, `tokens[${index}].reading 含表外假名：${outOfTable}`);
  }
  // Same kana-only surface/reading rule as word example tokens (は/へ/を must
  // be read as は/へ/を, never わ/え/お -- that would light the wrong cell).
  const surfaceReadingProblem = surfaceReadingMismatchReason(token.surface, token.reading);
  if (surfaceReadingProblem) {
    fail(file, id, `tokens[${index}] ${surfaceReadingProblem}`);
  }
  const romaji = codec.readingToRomaji(token.reading, { particle: token.particle }).romaji;
  return { ...token, morae, romaji };
}

/**
 * Validate + enrich one sentence seed. Checks bunsetsu coverage, that every
 * valid_orders entry (and preferred_order) is an actual permutation of the
 * bunsetsu indices ending on a predicate bunsetsu, then derives each
 * token's morae/romaji plus the sentence-level `ja`/`romaji`.
 *
 * bunsetsu/valid_orders/preferred_order are OPTIONAL (build task 2026-09-24
 * §A): a grammar example sentence may end in a sentence-final particle, a
 * ので-clause, or a plain/普通形 predicate that the arrange-practice
 * verb-final rule was never meant to judge. When any of them ARE supplied,
 * they're still fully validated here -- optional to provide, not optional
 * to get right. Whether a sentence actually NEEDS them (because an
 * ArrangeExercise references it) is checked separately, in validateExercise
 * below, at the point where that reference exists.
 */
export function enrichSentence(seed: SentenceSeed, file: string, codec: KanaCodec): Sentence {
  if (!/^s_[a-zA-Z0-9]+$/.test(seed.id)) fail(file, seed.id, `id 格式須為 s_ 加英數字：${seed.id}`);

  const n = seed.tokens.length;

  if (seed.bunsetsu !== undefined) {
    const flatBunsetsu = seed.bunsetsu.flat();
    if (!isPermutationOf(flatBunsetsu, n)) {
      fail(file, seed.id, `bunsetsu 未恰好覆蓋全部 ${n} 個 token 各一次：實際覆蓋 [${flatBunsetsu.join(",")}]`);
    }
  }

  if (seed.valid_orders !== undefined) {
    if (seed.bunsetsu === undefined) {
      fail(file, seed.id, "valid_orders 存在但缺少 bunsetsu（valid_orders 是 bunsetsu 索引的排列，兩者必須同時提供）");
    }
    const bunsetsu = seed.bunsetsu;
    const nb = bunsetsu.length;
    if (seed.valid_orders.length === 0) fail(file, seed.id, "valid_orders 不可為空");

    for (const [oi, order] of seed.valid_orders.entries()) {
      if (!isPermutationOf(order, nb)) {
        fail(file, seed.id, `valid_orders[${oi}] 不是 bunsetsu 索引的排列：[${order.join(",")}]`);
      }
      // 2026-09-24 §A: flatten this order's tokens and trim any trailing
      // sentence-final particle (か/ね/よ) BEFORE checking predicate-finality
      // -- a sentence like "...ますか" or "...ですね" still has its verb/です
      // last in the sense that matters for arrange practice.
      const orderedTokens = order.flatMap((bIdx) => bunsetsu[bIdx].map((ti) => seed.tokens[ti]));
      const trimmed = trimTrailingFinalParticles(orderedTokens);
      const predicateToken = trimmed[trimmed.length - 1];
      if (!predicateToken || !endsWithPredicate(predicateToken.surface)) {
        fail(
          file,
          seed.id,
          `valid_orders[${oi}] 的動詞文節未在最後：略過句尾終助詞（か／ね／よ）後，最後一個 token "${predicateToken?.surface ?? "(無)"}" 不以 ます／です／ています／ません 結尾`,
        );
      }
    }
  }

  if (seed.preferred_order !== undefined) {
    if (seed.valid_orders === undefined || seed.bunsetsu === undefined) {
      fail(file, seed.id, "preferred_order 存在但缺少 valid_orders/bunsetsu");
    }
    const nb = seed.bunsetsu.length;
    if (!isPermutationOf(seed.preferred_order, nb)) {
      fail(file, seed.id, `preferred_order 不是 bunsetsu 索引的排列：[${seed.preferred_order.join(",")}]`);
    }
    if (!seed.valid_orders.some((o) => sameOrder(o, seed.preferred_order!))) {
      fail(file, seed.id, "preferred_order 必須是 valid_orders 之一");
    }
  }

  const builtTokens = seed.tokens.map((t, i) => enrichSentenceToken(t, i, file, seed.id, codec));
  const ja = builtTokens.map((t) => t.surface).join("") + "。";
  const romaji = builtTokens.map((t) => t.romaji).join(" ");

  return { ...seed, tokens: builtTokens, ja, romaji };
}

/** Whole-bank sentence checks: id uniqueness across every data/sentences/*.json file. */
export function validateSentences(rawSentences: RawSentence[]): void {
  const seenIds = new Map<string, string>();
  for (const { file, seed } of rawSentences) {
    const prevFile = seenIds.get(seed.id);
    if (prevFile) fail(file, seed.id, `id 與 ${prevFile} 重複`);
    seenIds.set(seed.id, file);
  }
}

async function loadSentenceSeeds(): Promise<RawSentence[]> {
  const filenames = (await readdir(SENTENCES_DIR)).filter((f) => f.endsWith(".json")).sort();
  const out: RawSentence[] = [];
  for (const filename of filenames) {
    const raw = await readFile(join(SENTENCES_DIR, filename), "utf8");
    let file: SentenceFile;
    try {
      file = JSON.parse(raw) as SentenceFile;
    } catch (err) {
      fail(filename, "-", `JSON 解析失敗：${(err as Error).message}`);
    }
    for (const seed of file.sentences) out.push({ file: filename, seed });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Particles (build task 2026-09 step 4, DESIGN.md §8.4). No derived fields --
// validate then pass through unchanged into bank.json's `particles`.

const PARTICLE_ID_SET: ReadonlySet<string> = new Set(PARTICLE_IDS);

/** Validate data/particles.json against the fixed 8-particle schema, needing the full sentence-id set to check senses/contrast_sets references. */
export function validateParticles(file: ParticlesFile, sentenceIds: ReadonlySet<string>): void {
  const path = "data/particles.json";

  const seenIds = new Set<string>();
  for (const p of file.particles) {
    if (!PARTICLE_ID_SET.has(p.id)) fail(path, p.id, `id 不在八大助詞固定集合內：${p.id}`);
    if (seenIds.has(p.id)) fail(path, p.id, `id 重複：${p.id}`);
    seenIds.add(p.id);

    if (!(PARTICLE_CLASS_VALUES as readonly string[]).includes(p.class)) {
      fail(path, p.id, `class 不在 kaku/kakari/rentai 內：${p.class}`);
    }
    if (!(PARTICLE_WEIGHT_VALUES as readonly string[]).includes(p.weight)) {
      fail(path, p.id, `weight 不在 heavy/medium/light 內：${p.weight}`);
    }
    if (!VALID_CELL_IDS.has(p.cell)) {
      fail(path, p.id, `cell 不在 46 格內：${p.cell}`);
    }
    for (const c of p.contrast_with) {
      if (!PARTICLE_ID_SET.has(c)) fail(path, p.id, `contrast_with 含未知助詞 id：${c}`);
    }
    if (p.senses.length === 0) fail(path, p.id, "senses 不可為空");
    for (const [si, sense] of p.senses.entries()) {
      if (!sense.label) fail(path, p.id, `senses[${si}] 缺少 label`);
      if (!sentenceIds.has(sense.example_id)) {
        fail(path, p.id, `senses[${si}].example_id 指向不存在的句子：${sense.example_id}`);
      }
    }
  }
  if (seenIds.size !== PARTICLE_IDS.length) {
    const missing = PARTICLE_IDS.filter((id) => !seenIds.has(id));
    fail(path, "-", `particles 未涵蓋全部八大助詞，缺：${missing.join(",")}`);
  }

  const seenSetIds = new Set<string>();
  for (const cs of file.contrast_sets) {
    if (seenSetIds.has(cs.id)) fail(path, cs.id, `contrast_sets id 重複：${cs.id}`);
    seenSetIds.add(cs.id);

    for (const pid of cs.particles) {
      if (!PARTICLE_ID_SET.has(pid)) fail(path, cs.id, `particles 含未知助詞 id：${pid}`);
    }
    if (!cs.title) fail(path, cs.id, "缺少 title");
    if (!cs.summary) fail(path, cs.id, "缺少 summary");
    if (cs.pairs.length === 0) fail(path, cs.id, "pairs 不可為空");
    for (const [pi, pair] of cs.pairs.entries()) {
      if (!sentenceIds.has(pair.sentence_id)) {
        fail(path, cs.id, `pairs[${pi}].sentence_id 指向不存在的句子：${pair.sentence_id}`);
      }
      if (!pair.note) fail(path, cs.id, `pairs[${pi}] 缺少 note`);
    }
  }
}

// ---------------------------------------------------------------------------
// Grammar items (build task 2026-09-24 §A): generalizes the 8-particle
// model above into a category-tagged model that can hold ~30 grammar
// points. data/particles.json is DELETED -- the ParticlesFile validated by
// validateParticles above is now DERIVED from the matching 8 entries of
// data/grammar/items.json (see deriveParticlesFile below), so every
// existing consumer of bank.particles/getParticle keeps working unchanged.

const GRAMMAR_ID_RE = /^[a-z][a-z0-9-]*$/;
const GRAMMAR_CATEGORY_SET: ReadonlySet<string> = new Set(GRAMMAR_CATEGORY_VALUES);
const GRAMMAR_WEIGHT_SET: ReadonlySet<string> = new Set(GRAMMAR_WEIGHT_VALUES);

/** Validate data/grammar/items.json's semantic rules (shape already checked by GrammarFileSchema in loadGrammarItems). */
export function validateGrammarItems(file: GrammarFile, sentenceIds: ReadonlySet<string>): void {
  const path = "data/grammar/items.json";
  const seenIds = new Set<string>();
  for (const item of file.items) {
    if (!GRAMMAR_ID_RE.test(item.id)) fail(path, item.id, `id 須為 ascii slug（小寫英數字與連字號）：${item.id}`);
    if (seenIds.has(item.id)) fail(path, item.id, `id 重複：${item.id}`);
    seenIds.add(item.id);

    if (!GRAMMAR_CATEGORY_SET.has(item.category)) {
      fail(path, item.id, `category 不在枚舉內：${item.category}`);
    }
    if (item.weight !== undefined && !GRAMMAR_WEIGHT_SET.has(item.weight)) {
      fail(path, item.id, `weight 不在 heavy/medium/light 內：${item.weight}`);
    }
    if (item.cell !== undefined && !VALID_CELL_IDS.has(item.cell)) {
      fail(path, item.id, `cell 不在 46 格內：${item.cell}`);
    }
    if (item.senses.length === 0) fail(path, item.id, "senses 不可為空");
    for (const [si, sense] of item.senses.entries()) {
      if (!sense.label) fail(path, item.id, `senses[${si}] 缺少 label`);
      if (!sense.explanation) fail(path, item.id, `senses[${si}] 缺少 explanation`);
      if (sense.example_ids.length === 0) {
        fail(path, item.id, `senses[${si}] 至少要有一個例句（example_ids 不可為空）`);
      }
      for (const [ei, exId] of sense.example_ids.entries()) {
        if (!sentenceIds.has(exId)) {
          fail(path, item.id, `senses[${si}].example_ids[${ei}] 指向不存在的句子：${exId}`);
        }
      }
    }
  }

  // Second pass (needs every id collected first): contrast_with must point
  // at an id that ALREADY exists in this same items.json -- no forward
  // references to an item a later content author hasn't written yet (build
  // task's own §B: "示範階段 contrast_with 只放已存在的 id" -- chosen strict).
  for (const item of file.items) {
    for (const cid of item.contrast_with ?? []) {
      if (!seenIds.has(cid)) {
        fail(path, item.id, `contrast_with 含未知的 grammar item id：${cid}（只能指向 items.json 裡已存在的 id）`);
      }
    }
  }
}

/** Validate data/grammar/contrasts.json -- same rules as the old particles.json's contrast_sets loop (now inlined into validateParticles above for the DERIVED ParticlesFile), generalized to accept any grammar item id, not just the fixed 8 particles. */
export function validateGrammarContrasts(
  file: { contrast_sets: ContrastSet[] },
  grammarItemIds: ReadonlySet<string>,
  sentenceIds: ReadonlySet<string>,
): void {
  const path = "data/grammar/contrasts.json";
  const seenSetIds = new Set<string>();
  for (const cs of file.contrast_sets) {
    if (seenSetIds.has(cs.id)) fail(path, cs.id, `contrast_sets id 重複：${cs.id}`);
    seenSetIds.add(cs.id);

    for (const pid of cs.particles) {
      if (!grammarItemIds.has(pid)) fail(path, cs.id, `particles 含未知的 grammar item id：${pid}`);
    }
    if (!cs.title) fail(path, cs.id, "缺少 title");
    if (!cs.summary) fail(path, cs.id, "缺少 summary");
    if (cs.pairs.length === 0) fail(path, cs.id, "pairs 不可為空");
    for (const [pi, pair] of cs.pairs.entries()) {
      if (!sentenceIds.has(pair.sentence_id)) {
        fail(path, cs.id, `pairs[${pi}].sentence_id 指向不存在的句子：${pair.sentence_id}`);
      }
      if (!pair.note) fail(path, cs.id, `pairs[${pi}] 缺少 note`);
    }
  }
}

async function loadGrammarItems(): Promise<GrammarFile> {
  const raw = await readFile(GRAMMAR_ITEMS_PATH, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    fail("data/grammar/items.json", "-", `JSON 解析失敗：${(err as Error).message}`);
  }
  const result = GrammarFileSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const pathStr = issue.path.join(".") || "(root)";
    fail("data/grammar/items.json", "-", `schema 驗證失敗：${pathStr} - ${issue.message}`);
  }
  return result.data as GrammarFile;
}

async function loadGrammarContrasts(): Promise<{ contrast_sets: ContrastSet[] }> {
  const raw = await readFile(GRAMMAR_CONTRASTS_PATH, "utf8");
  try {
    return JSON.parse(raw) as { contrast_sets: ContrastSet[] };
  } catch (err) {
    fail("data/grammar/contrasts.json", "-", `JSON 解析失敗：${(err as Error).message}`);
  }
}

/**
 * The `class` field a back-compat Particle needs, reconstructed from a
 * GrammarItem's `category` -- lossy in general (both the old kaku and
 * rentai classes map to the new category "case"), so の is special-cased
 * back to "rentai" since it's the one migrated item where that actually
 * matters (build task's own §A migration note: "rentai→case（の 歸格助詞，
 * 符合使用者列表）" describes the forward direction; this is its inverse).
 */
function classForMigratedItem(item: GrammarItem): Particle["class"] {
  if (item.id === "no") return "rentai";
  return item.category === "focus" ? "kakari" : "kaku";
}

/**
 * DERIVES a ParticlesFile from the matching 8 entries of `items` (build task
 * 2026-09-24 §A: data/particles.json is deleted, but every existing
 * consumer of bank.particles/getParticle -- ParticleSwapView, swap.ts, the
 * 24 seeded particle-swap exercises, validateParticles itself -- keeps
 * working byte-for-byte unchanged against this derived view). `romaji` is
 * recomputed via the codec rather than stored in items.json -- GrammarItem
 * has no romaji field, deliberately (build task §A's own interface): a
 * particle's romaji is exactly what readingToRomaji(reading, {particle:
 * true}) already gives for free (the は/へ override applies on the
 * `particle: true` flag alone, not on any stored data).
 */
function deriveParticlesFile(items: GrammarItem[], contrastSets: ContrastSet[], codec: KanaCodec): ParticlesFile {
  const byId = new Map(items.map((it) => [it.id, it]));
  const particles: Particle[] = PARTICLE_IDS.map((id) => {
    const item = byId.get(id);
    if (!item) fail("data/grammar/items.json", id, `缺少八大助詞之一：${id}`);
    const romaji = codec.readingToRomaji(item.reading, { particle: true }).romaji;
    return {
      id: id as ParticleId,
      surface: item.surface,
      reading: item.reading,
      romaji,
      romaji_note: id === "wa" ? "寫作 は，讀作 wa" : null,
      cell: item.cell as Particle["cell"], // guaranteed present -- all 8 migrated items are single-mora particles
      class: classForMigratedItem(item),
      core: item.core,
      zh_bridge: item.zh_bridge ?? "",
      senses: item.senses.map((s) => ({ label: s.label, example_id: s.example_ids[0] })),
      contrast_with: (item.contrast_with ?? []) as ParticleId[],
      weight: item.weight ?? "medium",
    };
  });
  return { particles, contrast_sets: contrastSets };
}

// ---------------------------------------------------------------------------
// Practice exercises (build task 2026-09 step 5, DESIGN.md §8.5). Like
// particles.json, nothing here is computed at build time -- validate then
// pass through unchanged into bank.json's `exercises` field. Needs the full
// Sentence list (not just their ids) because both exercise types validate
// something ABOUT the referenced sentence's shape (bunsetsu count / which
// token is a particle), not just that the id exists.

const EXERCISE_ID_RE = /^(ax|px)_[a-zA-Z0-9]+$/;
const SWAP_VERDICT_SET: ReadonlySet<string> = new Set(SWAP_VERDICT_VALUES);

/** One raw exercise, tagged with the filename it came from. */
export interface RawExercise {
  file: string;
  exercise: Exercise;
}

/** Validate one exercise against the fixed arrange/particle-swap schemas. `sentencesById` must already contain every built Sentence (bunsetsu/tokens are read off it). */
export function validateExercise(
  exercise: Exercise,
  file: string,
  sentencesById: ReadonlyMap<string, Sentence>,
): void {
  const id = exercise.id;
  if (!EXERCISE_ID_RE.test(id)) {
    fail(file, id, `id 格式須為 ax_ 或 px_ 加英數字：${id}`);
  }

  const sentence = sentencesById.get(exercise.sentence_id);
  if (!sentence) {
    fail(file, id, `sentence_id 指向不存在的句子：${exercise.sentence_id}`);
  }

  if (exercise.type === "arrange") {
    // 2026-09-24 §A: bunsetsu/valid_orders are now optional on Sentence --
    // only a sentence actually referenced by an arrange exercise MUST carry
    // them, and this is the point of reference.
    if (!sentence.bunsetsu || !sentence.valid_orders || sentence.valid_orders.length === 0) {
      fail(
        file,
        id,
        `sentence_id ${exercise.sentence_id} 缺少 bunsetsu/valid_orders，不能用於排列練習（只有被排列練習引用的句子才需要提供）`,
      );
    }
    if (sentence.bunsetsu.length < 2) {
      fail(file, id, `sentence_id ${exercise.sentence_id} 的句子少於 2 個文節，不適合排列練習`);
    }
    if (exercise.distractors.length !== 0) {
      fail(file, id, "distractors 這版必須固定為空陣列");
    }
    return;
  }

  // particle-swap
  const slotToken = sentence.tokens[exercise.slot_token_index];
  if (!slotToken) {
    fail(
      file,
      id,
      `slot_token_index (${exercise.slot_token_index}) 超出句子 ${exercise.sentence_id} 的 token 範圍`,
    );
  }
  if (!slotToken.particle) {
    fail(
      file,
      id,
      `slot_token_index (${exercise.slot_token_index}) 指向的 token "${slotToken.surface}" 不是助詞（particle:true）`,
    );
  }

  if (exercise.candidates.length === 0) {
    fail(file, id, "candidates 不可為空");
  }
  const seenParticleIds = new Set<string>();
  let hasNatural = false;
  for (const [ci, candidate] of exercise.candidates.entries()) {
    if (!PARTICLE_ID_SET.has(candidate.particle_id)) {
      fail(file, id, `candidates[${ci}].particle_id 不在八大助詞內：${candidate.particle_id}`);
    }
    if (seenParticleIds.has(candidate.particle_id)) {
      fail(file, id, `candidates[${ci}].particle_id 重複：${candidate.particle_id}`);
    }
    seenParticleIds.add(candidate.particle_id);

    if (!SWAP_VERDICT_SET.has(candidate.verdict)) {
      fail(file, id, `candidates[${ci}].verdict 不在四值內：${candidate.verdict}`);
    }
    if (candidate.verdict === "natural") hasNatural = true;
    if (candidate.verdict === "invalid" && candidate.translation !== null) {
      fail(file, id, `candidates[${ci}] verdict 為 invalid 時 translation 必須是 null`);
    }
    if (!candidate.note) {
      fail(file, id, `candidates[${ci}] 缺少 note`);
    }
  }
  if (!hasNatural) {
    fail(file, id, "candidates 至少要有一個 natural");
  }

  for (const focusId of exercise.focus) {
    if (!seenParticleIds.has(focusId)) {
      fail(file, id, `focus 含未出現在 candidates 裡的助詞 id：${focusId}`);
    }
  }
}

/** Whole-exercises-set checks: id uniqueness across every data/exercises/*.json file. */
export function validateExercises(
  rawExercises: RawExercise[],
  sentencesById: ReadonlyMap<string, Sentence>,
): void {
  const seenIds = new Map<string, string>();
  for (const { file, exercise } of rawExercises) {
    const prevFile = seenIds.get(exercise.id);
    if (prevFile) fail(file, exercise.id, `id 與 ${prevFile} 重複`);
    seenIds.set(exercise.id, file);
    validateExercise(exercise, file, sentencesById);
  }
}

async function loadExerciseFiles(): Promise<RawExercise[]> {
  const filenames = (await readdir(EXERCISES_DIR)).filter((f) => f.endsWith(".json")).sort();
  const out: RawExercise[] = [];
  for (const filename of filenames) {
    const raw = await readFile(join(EXERCISES_DIR, filename), "utf8");
    let file: ExerciseFile;
    try {
      file = JSON.parse(raw) as ExerciseFile;
    } catch (err) {
      fail(filename, "-", `JSON 解析失敗：${(err as Error).message}`);
    }
    for (const exercise of file.exercises) out.push({ file: filename, exercise });
  }
  return out;
}

async function loadSeeds(): Promise<RawDay[]> {
  const filenames = (await readdir(WORDS_DIR)).filter((f) => f.endsWith(".json")).sort();
  const out: RawDay[] = [];
  for (const filename of filenames) {
    const raw = await readFile(join(WORDS_DIR, filename), "utf8");
    let seed: DaySeed;
    try {
      seed = JSON.parse(raw) as DaySeed;
    } catch (err) {
      fail(filename, "-", `JSON 解析失敗：${(err as Error).message}`);
    }
    out.push({ file: filename, seed });
  }
  return out;
}

/** Every surface in data/frequency/n5.json (review item 5(a): the frequency table is one of the two sources a hand-authored example's kanji is allowed to come from -- the other is every existing word's own surface, added in buildBank below). */
async function loadFrequencySurfaces(): Promise<string[]> {
  const raw = await readFile(FREQUENCY_PATH, "utf8");
  const freq = JSON.parse(raw) as { words: { surface: string }[] };
  return freq.words.map((w) => w.surface);
}

/** Pure(ish) build step: validate + enrich every seed into a Bank. Takes the codec as a parameter so it's testable without touching disk. */
export async function buildBank(codec: KanaCodec): Promise<Bank> {
  const rawDays = await loadSeeds();

  // Review item 5(a): build-bank.ts's own real invocation always runs the
  // example-kanji-scope + example.ja-uniqueness checks (validateWordSet's
  // `opts.knownKanji` is optional only for backward compatibility with its
  // pre-existing placeholder-fixture tests, which never populate it).
  const freqSurfaces = await loadFrequencySurfaces();
  const existingSurfaces = rawDays.flatMap(({ seed }) => seed.words.map((w) => w.surface));
  const knownKanji = buildKnownKanji([...freqSurfaces, ...existingSurfaces]);
  validateBank(rawDays, { knownKanji });

  const days: DayEntry[] = rawDays
    .map(({ file, seed }) => ({
      date: seed.date,
      words: seed.words.map((w) => enrichWord(w, file, codec)),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const words = days.flatMap((d) => d.words);

  const rawSentences = await loadSentenceSeeds();
  validateSentences(rawSentences);
  const sentences = rawSentences.map(({ file, seed }) => enrichSentence(seed, file, codec));
  const sentenceIds = new Set(sentences.map((s) => s.id));

  const grammarFile = await loadGrammarItems();
  validateGrammarItems(grammarFile, sentenceIds);
  const grammarItemIds = new Set(grammarFile.items.map((it) => it.id));

  const contrastsFile = await loadGrammarContrasts();
  validateGrammarContrasts(contrastsFile, grammarItemIds, sentenceIds);

  const grammar: GrammarBank = { items: grammarFile.items, contrasts: contrastsFile.contrast_sets };

  // Back-compat derived view (build task 2026-09-24 §A) -- see
  // deriveParticlesFile's own doc for why this keeps every pre-existing
  // consumer of bank.particles working unchanged. validateParticles still
  // runs against it as a safety net (same function, same checks as before).
  const particles = deriveParticlesFile(grammarFile.items, contrastsFile.contrast_sets, codec);
  validateParticles(particles, sentenceIds);

  const sentencesById = new Map(sentences.map((s) => [s.id, s]));
  const rawExercises = await loadExerciseFiles();
  validateExercises(rawExercises, sentencesById);
  const exercises = rawExercises.map(({ exercise }) => exercise);

  return { generated_at: new Date().toISOString(), days, words, sentences, particles, grammar, exercises };
}

async function main(): Promise<void> {
  const codec: KanaCodec = { kanaToCells, readingToRomaji };
  const bank = await buildBank(codec);
  await writeFile(BANK_PATH, JSON.stringify(bank, null, 2) + "\n", "utf8");
  const perDay = bank.days.map((d) => `${d.date}(${d.words.length})`).join(" / ");
  console.log(
    `data/bank.json: ${bank.days.length} 天、${bank.words.length} 詞、${bank.sentences.length} 句、${bank.particles.particles.length} 助詞、${bank.grammar.items.length} 文法項目、${bank.exercises.length} 練習題 -- ${perDay}`,
  );
}

// CLI guard: only run when this file is the process entry point, so tests
// can import enrichWord/validateBank/buildBank without side effects.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err: unknown) => {
    if (err instanceof BuildError) {
      console.error(`[build-bank] ${err.message}`);
    } else {
      console.error(err);
    }
    process.exit(1);
  });
}
