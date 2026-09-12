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
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { kanaToCells, readingToRomaji } from "../src/lib/kana/index.ts";
import { stripExamplePunctuation } from "../src/lib/bank/text.ts";
import { PARTICLE_CLASS_VALUES, PARTICLE_IDS, PARTICLE_WEIGHT_VALUES, POS_VALUES } from "../src/lib/bank/types.ts";
import type {
  Bank,
  BuiltExampleToken,
  BuiltSentenceToken,
  DayEntry,
  DaySeed,
  ExampleToken,
  JlptLevel,
  ParticlesFile,
  Sentence,
  SentenceFile,
  SentenceSeed,
  SentenceToken,
  Word,
  WordSeed,
} from "../src/lib/bank/types.ts";
import { KanaInputError } from "../src/lib/kana/types.ts";
import type { Mora } from "../src/lib/kana/types.ts";
import kanaData from "../data/kana.json" with { type: "json" };

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const WORDS_DIR = join(PROJECT_ROOT, "data", "words");
const SENTENCES_DIR = join(PROJECT_ROOT, "data", "sentences");
const PARTICLES_PATH = join(PROJECT_ROOT, "data", "particles.json");
const BANK_PATH = join(PROJECT_ROOT, "data", "bank.json");

/** Every valid 46-cell gojuon-table id, read straight off data/kana.json (includes "n"). Used to validate particles.json's `cell` field. */
const VALID_CELL_IDS = new Set<string>((kanaData as { cells: { id: string }[] }).cells.map((c) => c.id));

/** Predicate-ending suffixes that mark a bunsetsu as the sentence's verb/predicate (build task 2026-09 step 4: "動詞文節永遠最後"). */
const PREDICATE_SUFFIXES = ["ています", "ます", "です", "ません"];

function endsWithPredicate(surface: string): boolean {
  return PREDICATE_SUFFIXES.some((suf) => surface.endsWith(suf));
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

const LEVEL_VALUES: readonly JlptLevel[] = ["N5", "N4", "N3", "N2", "N1"];
const WORDS_PER_DAY = 10;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^w_\d{4,}$/;

/** Every surface allowed to carry `particle: true` on an example token. */
const PARTICLE_SURFACES = new Set([
  "は", "が", "を", "に", "で", "と", "の", "も", "へ",
  "か", "から", "まで", "や", "ね", "よ", "でも", "には", "では", "とか",
]);
/** Surfaces that are, on their own as a whole token, almost never anything BUT a particle. */
const ALWAYS_PARTICLE_SURFACES = new Set(["は", "を", "へ", "が"]);

/** The two functions this script needs out of src/lib/kana/, narrowed to what it actually calls. */
export interface KanaCodec {
  kanaToCells(reading: string, opts?: { particle?: boolean }): Mora[];
  readingToRomaji(reading: string, opts?: { particle?: boolean }): { romaji: string; romaji_ascii: string };
}

/** One raw (not-yet-enriched) day file, tagged with the filename it came from (for error messages). */
export interface RawDay {
  file: string;
  seed: DaySeed;
}

/** Thrown for any validation failure. Message is always "`${file} / ${id} / ${reason}`" per the build task's spec. */
export class BuildError extends Error {}

function fail(file: string, id: string, reason: string): never {
  throw new BuildError(`${file} / ${id} / ${reason}`);
}

/** KanaInputError.reason -> the Chinese label build-bank puts in front of its own error message. */
function kanaInputErrorLabel(err: unknown): string {
  if (err instanceof KanaInputError && err.reason === "orphan-small") {
    return "小字沒有可依附的前一拍";
  }
  return "含非假名字元";
}

/** The text of the first out-of-table mora in `morae` (ゐ/ゑ/ゕ/ゖ/踊り字...), or undefined if
 *  none. kanaToCells doesn't throw for these -- it just marks them `out_of_table` -- so callers
 *  that need to reject them (every authored reading in this bank) must check explicitly. */
function findOutOfTable(morae: Mora[]): string | undefined {
  return morae.find((m) => m.marks.includes("out_of_table"))?.text;
}

/** Run one example token through the codec, tagged with its own `particle` flag (§7 override). */
function enrichExampleToken(
  token: ExampleToken,
  index: number,
  file: string,
  id: string,
  codec: KanaCodec,
): BuiltExampleToken {
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
  const romaji = codec.readingToRomaji(token.reading, { particle: token.particle }).romaji;
  return { ...token, morae, romaji };
}

/**
 * Compute every derived field for one seed word: morae/romaji/romaji_ascii
 * from `reading`, and each example token's own morae/romaji (§ token
 * schema: particles are their own token, tagged `particle: true`, so は/へ/を
 * read correctly and an unrelated word-boundary vowel never gets merged
 * into a long vowel it isn't). Also checks everything about this one word
 * that doesn't require looking at the rest of the bank. Throws BuildError
 * on the first problem found.
 */
export function enrichWord(seed: WordSeed, file: string, codec: KanaCodec): Word {
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
 */
export function validateBank(days: RawDay[]): void {
  const seenIds = new Map<string, string>(); // id -> file
  const seenSurfaceReading = new Map<string, string>(); // "surface|reading" -> file
  const seenFreqRanks = new Map<number, string>(); // freq_rank -> file
  const confusableById = new Map<string, { file: string; list: string[] }>();

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
  const romaji = codec.readingToRomaji(token.reading, { particle: token.particle }).romaji;
  return { ...token, morae, romaji };
}

/**
 * Validate + enrich one sentence seed. Checks bunsetsu coverage, that every
 * valid_orders entry (and preferred_order) is an actual permutation of the
 * bunsetsu indices ending on a predicate bunsetsu, then derives each
 * token's morae/romaji plus the sentence-level `ja`/`romaji`.
 */
export function enrichSentence(seed: SentenceSeed, file: string, codec: KanaCodec): Sentence {
  if (!/^s_[a-zA-Z0-9]+$/.test(seed.id)) fail(file, seed.id, `id 格式須為 s_ 加英數字：${seed.id}`);

  const n = seed.tokens.length;
  const flatBunsetsu = seed.bunsetsu.flat();
  if (!isPermutationOf(flatBunsetsu, n)) {
    fail(file, seed.id, `bunsetsu 未恰好覆蓋全部 ${n} 個 token 各一次：實際覆蓋 [${flatBunsetsu.join(",")}]`);
  }

  const nb = seed.bunsetsu.length;
  if (seed.valid_orders.length === 0) fail(file, seed.id, "valid_orders 不可為空");

  for (const [oi, order] of seed.valid_orders.entries()) {
    if (!isPermutationOf(order, nb)) {
      fail(file, seed.id, `valid_orders[${oi}] 不是 bunsetsu 索引的排列：[${order.join(",")}]`);
    }
    const lastBunsetsuIdx = order[order.length - 1];
    const lastBunsetsu = seed.bunsetsu[lastBunsetsuIdx];
    const lastTokenIdx = lastBunsetsu[lastBunsetsu.length - 1];
    const lastToken = seed.tokens[lastTokenIdx];
    if (!endsWithPredicate(lastToken.surface)) {
      fail(
        file,
        seed.id,
        `valid_orders[${oi}] 的動詞文節未在最後：最後一個文節 (bunsetsu[${lastBunsetsuIdx}]) 的末 token "${lastToken.surface}" 不以 ます／です／ています／ません 結尾`,
      );
    }
  }

  if (!isPermutationOf(seed.preferred_order, nb)) {
    fail(file, seed.id, `preferred_order 不是 bunsetsu 索引的排列：[${seed.preferred_order.join(",")}]`);
  }
  if (!seed.valid_orders.some((o) => sameOrder(o, seed.preferred_order))) {
    fail(file, seed.id, "preferred_order 必須是 valid_orders 之一");
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

async function loadParticles(): Promise<ParticlesFile> {
  const raw = await readFile(PARTICLES_PATH, "utf8");
  try {
    return JSON.parse(raw) as ParticlesFile;
  } catch (err) {
    fail("data/particles.json", "-", `JSON 解析失敗：${(err as Error).message}`);
  }
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

/** Pure(ish) build step: validate + enrich every seed into a Bank. Takes the codec as a parameter so it's testable without touching disk. */
export async function buildBank(codec: KanaCodec): Promise<Bank> {
  const rawDays = await loadSeeds();
  validateBank(rawDays);

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

  const particles = await loadParticles();
  validateParticles(particles, sentenceIds);

  return { generated_at: new Date().toISOString(), days, words, sentences, particles };
}

async function main(): Promise<void> {
  const codec: KanaCodec = { kanaToCells, readingToRomaji };
  const bank = await buildBank(codec);
  await writeFile(BANK_PATH, JSON.stringify(bank, null, 2) + "\n", "utf8");
  const perDay = bank.days.map((d) => `${d.date}(${d.words.length})`).join(" / ");
  console.log(
    `data/bank.json: ${bank.days.length} 天、${bank.words.length} 詞、${bank.sentences.length} 句、${bank.particles.particles.length} 助詞 -- ${perDay}`,
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
