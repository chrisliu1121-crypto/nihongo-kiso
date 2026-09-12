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
import { POS_VALUES } from "../src/lib/bank/types.ts";
import type {
  Bank,
  BuiltExampleToken,
  DayEntry,
  DaySeed,
  ExampleToken,
  JlptLevel,
  Word,
  WordSeed,
} from "../src/lib/bank/types.ts";
import { KanaInputError } from "../src/lib/kana/types.ts";
import type { Mora } from "../src/lib/kana/types.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const WORDS_DIR = join(PROJECT_ROOT, "data", "words");
const BANK_PATH = join(PROJECT_ROOT, "data", "bank.json");

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

  return { generated_at: new Date().toISOString(), days, words };
}

async function main(): Promise<void> {
  const codec: KanaCodec = { kanaToCells, readingToRomaji };
  const bank = await buildBank(codec);
  await writeFile(BANK_PATH, JSON.stringify(bank, null, 2) + "\n", "utf8");
  const perDay = bank.days.map((d) => `${d.date}(${d.words.length})`).join(" / ");
  console.log(`data/bank.json: ${bank.days.length} 天、${bank.words.length} 詞 -- ${perDay}`);
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
