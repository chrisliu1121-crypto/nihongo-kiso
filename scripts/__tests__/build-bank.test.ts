import { describe, expect, it } from "vitest";
import { kanaToCells, readingToRomaji } from "../../src/lib/kana";
import { stripExamplePunctuation } from "../../src/lib/bank/text";
import type { DaySeed, ExampleToken, ParticlesFile, Sentence, SentenceSeed, WordSeed } from "../../src/lib/bank/types";
import type { ArrangeExercise, ParticleSwapExercise, SwapCandidate } from "../../src/lib/exercise/types";
import {
  BuildError,
  enrichSentence,
  enrichWord,
  validateBank,
  validateExercise,
  validateExercises,
  validateParticles,
  validateSentences,
  type KanaCodec,
  type RawDay,
  type RawExercise,
  type RawSentence,
} from "../build-bank";

// The real codec (same functions the app and build script both use) --
// enrichWord/validateBank take it as a parameter specifically so tests
// don't need to touch disk or the filesystem-walking parts of build-bank.ts.
const codec: KanaCodec = { kanaToCells, readingToRomaji };

const DEFAULT_TOKENS: ExampleToken[] = [
  { surface: "学校", reading: "がっこう" },
  { surface: "まで", reading: "まで", particle: true },
  { surface: "歩いて", reading: "あるいて" },
  { surface: "行きます", reading: "いきます" },
];

function makeSeed(overrides: Partial<WordSeed> = {}): WordSeed {
  return {
    id: "w_0001",
    surface: "学校",
    reading: "がっこう",
    gloss: "學校",
    pos: "名詞",
    level: "N5",
    freq_rank: 1,
    romaji_override: null,
    example: {
      ja: "学校まで歩いて行きます。",
      zh: "走路去學校。",
      tokens: DEFAULT_TOKENS,
    },
    collocations: [],
    confusable_with: [],
    note: null,
    pitch: null,
    audio: null,
    source: "seed-manual",
    verified: true,
    ...overrides,
  };
}

function makeDay(file: string, words: WordSeed[]): RawDay {
  const date = file.replace(/\.json$/, "");
  const seed: DaySeed = { date, words };
  return { file, seed };
}

describe("stripExamplePunctuation", () => {
  it("去除。與、，其餘假名不動", () => {
    expect(stripExamplePunctuation("学校まで、歩いて行きます。")).toBe("学校まで歩いて行きます");
  });
});

describe("enrichWord", () => {
  it("がっこう 的 morae 與 DESIGN §8.2 逐拍一致", () => {
    const word = enrichWord(makeSeed(), "2026-09-05.json", codec);
    expect(word.morae).toEqual([
      { index: 0, text: "が", cells: ["ka"], marks: ["dakuten"], romaji: "ga" },
      { index: 1, text: "っ", cells: ["tsu"], marks: ["sokuon"], romaji: "k" },
      { index: 2, text: "こ", cells: ["ko"], marks: [], romaji: "kō" },
      { index: 3, text: "う", cells: ["u"], marks: ["chouon"], romaji: "" },
    ]);
    expect(word.romaji).toBe("gakkō");
    expect(word.romaji_ascii).toBe("gakkou");
  });

  it("romaji_override 生效；romaji_ascii 仍由 reading 推導、不受 override 影響", () => {
    const word = enrichWord(
      makeSeed({
        id: "w_0002",
        surface: "東京",
        reading: "とうきょう",
        romaji_override: "TOKYO-OVERRIDE",
        example: {
          ja: "東京に行きます。",
          zh: "去東京。",
          tokens: [
            { surface: "東京", reading: "とうきょう" },
            { surface: "に", reading: "に", particle: true },
            { surface: "行きます", reading: "いきます" },
          ],
        },
      }),
      "2026-09-05.json",
      codec,
    );
    expect(word.romaji).toBe("TOKYO-OVERRIDE");
    expect(word.romaji_ascii).toBe("toukyou");
  });

  it("例句每個 token 各自算 morae/romaji，particle token 的 は/へ/を 讀成 wa/e/o", () => {
    const word = enrichWord(
      makeSeed({
        id: "w_0003",
        example: {
          ja: "私は学生です。",
          zh: "我是學生。",
          tokens: [
            { surface: "私", reading: "わたし" },
            { surface: "は", reading: "は", particle: true },
            { surface: "学生です", reading: "がくせいです" },
          ],
        },
      }),
      "2026-09-05.json",
      codec,
    );
    const [watashi, ha, gakuseidesu] = word.example.tokens;
    expect(watashi.romaji).toBe("watashi");
    expect(ha.romaji).toBe("wa"); // NOT "ha" -- this is the whole point of tokenizing particles
    expect(ha.morae).toEqual([{ index: 0, text: "は", cells: ["ha"], marks: [], romaji: "wa" }]);
    expect(gakuseidesu.romaji).toBe("gakuseidesu");
    expect(word.example.romaji).toBe("watashi wa gakuseidesu");
  });

  it("が+あ 這種詞界巧合不再被誤判成長音（token 化前會壞掉的案例）", () => {
    const word = enrichWord(
      makeSeed({
        id: "w_0004",
        example: {
          ja: "お金がありません。",
          zh: "沒有錢。",
          tokens: [
            { surface: "お金", reading: "おかね" },
            { surface: "が", reading: "が", particle: true },
            { surface: "ありません", reading: "ありません" },
          ],
        },
      }),
      "2026-09-05.json",
      codec,
    );
    expect(word.example.romaji).toBe("okane ga arimasen"); // not "okanegārimasen"
  });

  it("example.ja 與 tokens 串接不一致時拋出 BuildError", () => {
    const build = () =>
      enrichWord(
        makeSeed({
          id: "w_0005",
          example: {
            ja: "学校まで走って行きます。", // "走って" doesn't match any token below
            zh: "跑步去學校。",
            tokens: DEFAULT_TOKENS,
          },
        }),
        "mismatch.json",
        codec,
      );
    expect(build).toThrow(BuildError);
    expect(build).toThrow(/^mismatch\.json \/ w_0005 \/ example\.ja 與 tokens 串接不一致/);
  });

  it("example.tokens[i].reading 含非假名字元被抓", () => {
    const build = () =>
      enrichWord(
        makeSeed({
          id: "w_0006",
          example: {
            ja: "学校に行きます。",
            zh: "去學校。",
            tokens: [
              { surface: "学校", reading: "school" }, // not kana
              { surface: "に", reading: "に", particle: true },
              { surface: "行きます", reading: "いきます" },
            ],
          },
        }),
        "bad-token.json",
        codec,
      );
    expect(build).toThrow(BuildError);
    expect(build).toThrow(/^bad-token\.json \/ w_0006 \/ example\.tokens\[0\]\.reading 含非假名字元/);
  });

  it("非假名 reading 被抓：拋出 BuildError，訊息含檔名與 id", () => {
    expect(() => enrichWord(makeSeed({ id: "w_0007", reading: "gakkou" }), "bad.json", codec)).toThrow(
      BuildError,
    );
    expect(() => enrichWord(makeSeed({ id: "w_0007", reading: "gakkou" }), "bad.json", codec)).toThrow(
      /^bad\.json \/ w_0007 \//,
    );
  });

  it("reading 含表外假名（ゐ）被抓：kanaToCells 不拋錯，靠 marks 檢查補上", () => {
    const build = () => enrichWord(makeSeed({ id: "w_0010", reading: "ゐ" }), "wi.json", codec);
    expect(build).toThrow(BuildError);
    expect(build).toThrow(/^wi\.json \/ w_0010 \/ reading 含表外假名：ゐ$/);
  });

  it("example.tokens[i].reading 含表外假名（ゐ）也被抓", () => {
    const build = () =>
      enrichWord(
        makeSeed({
          id: "w_0011",
          example: {
            ja: "ゐを見ます。",
            zh: "（測試用）",
            tokens: [
              { surface: "ゐ", reading: "ゐ" },
              { surface: "を", reading: "を", particle: true },
              { surface: "見ます", reading: "みます" },
            ],
          },
        }),
        "token-wi.json",
        codec,
      );
    expect(build).toThrow(BuildError);
    expect(build).toThrow(/^token-wi\.json \/ w_0011 \/ example\.tokens\[0\]\.reading 含表外假名：ゐ$/);
  });

  it("孤兒小字 reading 的錯誤訊息分類為「小字沒有可依附的前一拍」，非「含非假名字元」", () => {
    const build = () => enrichWord(makeSeed({ id: "w_0012", reading: "ゃ" }), "orphan.json", codec);
    expect(build).toThrow(BuildError);
    expect(build).toThrow(/^orphan\.json \/ w_0012 \/ reading 小字沒有可依附的前一拍：/);
  });

  it("pos 不在枚舉內、level 不在 N5–N1 內、verified 非 boolean 都會被抓", () => {
    expect(() => enrichWord(makeSeed({ pos: "動名詞" as WordSeed["pos"] }), "x.json", codec)).toThrow(
      BuildError,
    );
    expect(() => enrichWord(makeSeed({ level: "N6" as WordSeed["level"] }), "x.json", codec)).toThrow(
      BuildError,
    );
    expect(() =>
      enrichWord(makeSeed({ verified: "true" as unknown as boolean }), "x.json", codec),
    ).toThrow(BuildError);
  });

  it("particle:true 但 surface 不在助詞白名單內（例如 はな）被抓", () => {
    const build = () =>
      enrichWord(
        makeSeed({
          id: "w_0008",
          example: {
            ja: "はな学校です。",
            zh: "（測試用）",
            tokens: [
              { surface: "はな", reading: "はな", particle: true },
              { surface: "学校です", reading: "がっこうです" },
            ],
          },
        }),
        "particle-bad.json",
        codec,
      );
    expect(build).toThrow(BuildError);
    expect(build).toThrow(
      /^particle-bad\.json \/ w_0008 \/ example\.tokens\[0\] 標了 particle:true 但 surface "はな" 不在助詞白名單內/,
    );
  });

  it("surface 恰為 を（幾乎必為助詞）但未標 particle 被抓", () => {
    const build = () =>
      enrichWord(
        makeSeed({
          id: "w_0009",
          example: {
            ja: "水を飲みます。",
            zh: "喝水。",
            tokens: [
              { surface: "水", reading: "みず" },
              { surface: "を", reading: "を" }, // missing particle: true
              { surface: "飲みます", reading: "のみます" },
            ],
          },
        }),
        "particle-missing.json",
        codec,
      );
    expect(build).toThrow(BuildError);
    expect(build).toThrow(
      /^particle-missing\.json \/ w_0009 \/ example\.tokens\[1\] surface "を" 幾乎必為助詞，但未標 particle:true/,
    );
  });
});

describe("validateBank", () => {
  it("重複 id 被抓", () => {
    const dayA = makeDay(
      "2026-01-01.json",
      Array.from({ length: 10 }, (_, i) =>
        makeSeed({
          id: i === 0 ? "w_0099" : `w_010${i}`,
          surface: `甲${i}`,
          reading: "あ",
          freq_rank: i + 1,
        }),
      ),
    );
    const dayB = makeDay(
      "2026-01-02.json",
      Array.from({ length: 10 }, (_, i) =>
        makeSeed({
          id: i === 0 ? "w_0099" : `w_020${i}`,
          surface: `乙${i}`,
          reading: "い",
          freq_rank: 100 + i,
        }),
      ),
    );
    expect(() => validateBank([dayA, dayB])).toThrow(BuildError);
    expect(() => validateBank([dayA, dayB])).toThrow(/id 與 2026-01-01\.json 重複/);
  });

  it("surface+reading 重複被抓", () => {
    const day = makeDay(
      "2026-01-03.json",
      Array.from({ length: 10 }, (_, i) =>
        makeSeed({
          id: `w_030${i}`,
          surface: i === 1 ? "学校" : `丙${i}`,
          reading: i === 1 ? "がっこう" : "あ",
          freq_rank: i + 1,
        }),
      ),
    );
    // duplicate the first word's surface+reading onto the last slot
    day.seed.words[9] = { ...day.seed.words[0], id: "w_0399" };
    expect(() => validateBank([day])).toThrow(/surface\+reading 與 2026-01-03\.json 重複/);
  });

  it("每檔恰 10 詞的檢查", () => {
    const day = makeDay("2026-01-04.json", [makeSeed()]);
    expect(() => validateBank([day])).toThrow(/恰須 10 詞，實際 1/);
  });

  it("date 欄位須等於檔名", () => {
    const seed: DaySeed = {
      date: "2099-01-01",
      words: Array.from({ length: 10 }, (_, i) =>
        makeSeed({ id: `w_040${i}`, surface: `丁${i}`, reading: "あ" }),
      ),
    };
    expect(() => validateBank([{ file: "2026-01-05.json", seed }])).toThrow(
      /date 欄位 \(2099-01-01\) 與檔名 \(2026-01-05\) 不符/,
    );
  });

  it("同檔內 freq_rank 未嚴格遞增被抓", () => {
    const day = makeDay(
      "2026-02-01.json",
      Array.from({ length: 10 }, (_, i) =>
        makeSeed({
          id: `w_050${i}`,
          surface: `戊${i}`,
          reading: "あ",
          freq_rank: i === 5 ? 3 : i + 1, // word[5] regresses to 3, <= word[4]'s 5
        }),
      ),
    );
    expect(() => validateBank([day])).toThrow(/freq_rank \(3\) 未嚴格遞增於前一詞 \(5\)/);
  });

  it("freq_rank 全庫不可重複（跨檔）", () => {
    const dayA = makeDay(
      "2026-02-02.json",
      Array.from({ length: 10 }, (_, i) =>
        makeSeed({ id: `w_060${i}`, surface: `己${i}`, reading: "あ", freq_rank: i + 1 }),
      ),
    );
    const dayB = makeDay(
      "2026-02-03.json",
      Array.from({ length: 10 }, (_, i) =>
        makeSeed({ id: `w_070${i}`, surface: `庚${i}`, reading: "い", freq_rank: i + 1 }), // reuses 1..10
      ),
    );
    expect(() => validateBank([dayA, dayB])).toThrow(/freq_rank 1 與 2026-02-02\.json 重複/);
  });

  it("confusable_with 不對稱（A 列 B，B 未回列 A）被抓", () => {
    const day = makeDay(
      "2026-02-04.json",
      Array.from({ length: 10 }, (_, i) =>
        makeSeed({
          id: `w_080${i}`,
          surface: `辛${i}`,
          reading: "あ",
          freq_rank: i + 1,
          confusable_with: i === 0 ? ["w_0801"] : [],
        }),
      ),
    );
    expect(() => validateBank([day])).toThrow(
      /confusable_with 不對稱：w_0800 列了 w_0801，但 w_0801 沒有回指 w_0800/,
    );
  });

  it("confusable_with 對稱時不報錯", () => {
    const day = makeDay(
      "2026-02-05.json",
      Array.from({ length: 10 }, (_, i) =>
        makeSeed({
          id: `w_090${i}`,
          surface: `壬${i}`,
          reading: "あ",
          freq_rank: i + 1,
          confusable_with: i === 0 ? ["w_0901"] : i === 1 ? ["w_0900"] : [],
        }),
      ),
    );
    expect(() => validateBank([day])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Grammar sentences (build task 2026-09 step 4)

function makeSentenceSeed(overrides: Partial<SentenceSeed> = {}): SentenceSeed {
  return {
    id: "s_g001",
    pattern_id: null,
    level: "N5",
    tokens: [
      { surface: "私", reading: "わたし", gloss: "我" },
      { surface: "は", reading: "は", gloss: "（主題）", particle: true },
      { surface: "学生", reading: "がくせい", gloss: "學生" },
      { surface: "です", reading: "です", gloss: "是" },
    ],
    bunsetsu: [[0, 1], [2, 3]],
    valid_orders: [[0, 1]],
    preferred_order: [0, 1],
    translation: "我是學生。",
    verified: true,
    tags: ["particle:wa"],
    ...overrides,
  };
}

describe("enrichSentence", () => {
  it("derives ja/romaji from tokens, particle は 讀成 wa", () => {
    const sentence = enrichSentence(makeSentenceSeed(), "grammar-seed.json", codec);
    expect(sentence.ja).toBe("私は学生です。");
    expect(sentence.romaji).toBe("watashi wa gakusei desu");
    expect(sentence.tokens[1].romaji).toBe("wa");
  });

  it("bunsetsu 未覆蓋全部 token 被抓", () => {
    const build = () =>
      enrichSentence(
        makeSentenceSeed({ id: "s_g002", bunsetsu: [[0, 1], [2]] }), // drops token 3
        "grammar-seed.json",
        codec,
      );
    expect(build).toThrow(BuildError);
    expect(build).toThrow(/bunsetsu 未恰好覆蓋全部 4 個 token 各一次/);
  });

  it("bunsetsu 重複覆蓋同一 token 被抓", () => {
    const build = () =>
      enrichSentence(
        makeSentenceSeed({ id: "s_g003", bunsetsu: [[0, 1], [1, 2, 3]] }), // token 1 twice
        "grammar-seed.json",
        codec,
      );
    expect(build).toThrow(BuildError);
    expect(build).toThrow(/bunsetsu 未恰好覆蓋全部 4 個 token 各一次/);
  });

  it("valid_orders 的動詞文節不在最後時被抓，訊息指出違反的 id", () => {
    const build = () =>
      enrichSentence(
        makeSentenceSeed({ id: "s_g004", valid_orders: [[1, 0]] }), // "学生です" bunsetsu first, "私は" last
        "grammar-seed.json",
        codec,
      );
    expect(build).toThrow(BuildError);
    expect(build).toThrow(/^grammar-seed\.json \/ s_g004 \/ valid_orders\[0\] 的動詞文節未在最後/);
  });

  it("valid_orders 不是 bunsetsu 索引排列時被抓", () => {
    const build = () =>
      enrichSentence(makeSentenceSeed({ id: "s_g005", valid_orders: [[0, 0]] }), "grammar-seed.json", codec);
    expect(build).toThrow(BuildError);
    expect(build).toThrow(/valid_orders\[0\] 不是 bunsetsu 索引的排列/);
  });

  it("preferred_order 不在 valid_orders 內時被抓", () => {
    const build = () =>
      enrichSentence(
        makeSentenceSeed({ id: "s_g006", valid_orders: [[0, 1]], preferred_order: [1, 0] }),
        "grammar-seed.json",
        codec,
      );
    expect(build).toThrow(BuildError);
    expect(build).toThrow(/preferred_order 必須是 valid_orders 之一/);
  });

  it("token particle:true 但不在助詞白名單內被抓（沿用 enrichExampleToken 同一套規則）", () => {
    const build = () =>
      enrichSentence(
        makeSentenceSeed({
          id: "s_g007",
          tokens: [
            { surface: "はな", reading: "はな", gloss: "花", particle: true },
            { surface: "です", reading: "です", gloss: "是" },
          ],
          bunsetsu: [[0], [1]],
        }),
        "grammar-seed.json",
        codec,
      );
    expect(build).toThrow(BuildError);
    expect(build).toThrow(/標了 particle:true 但 surface "はな" 不在助詞白名單內/);
  });
});

describe("validateSentences", () => {
  it("跨檔重複 id 被抓", () => {
    const a: RawSentence = { file: "a.json", seed: makeSentenceSeed({ id: "s_g001" }) };
    const b: RawSentence = { file: "b.json", seed: makeSentenceSeed({ id: "s_g001" }) };
    expect(() => validateSentences([a, b])).toThrow(BuildError);
    expect(() => validateSentences([a, b])).toThrow(/id 與 a\.json 重複/);
  });
});

// ---------------------------------------------------------------------------
// Particles (build task 2026-09 step 4)

function makeParticlesFile(overrides: Partial<ParticlesFile> = {}): ParticlesFile {
  const ids = ["wa", "ga", "wo", "ni", "de", "to", "no", "mo"] as const;
  return {
    particles: ids.map((id) => ({
      id,
      surface: id,
      reading: id,
      romaji: id,
      romaji_note: null,
      cell: "a",
      class: "kaku",
      core: "core",
      zh_bridge: "bridge",
      senses: [{ label: "sense", example_id: "s_g001" }],
      contrast_with: [],
      weight: "medium",
    })),
    contrast_sets: [],
    ...overrides,
  };
}

describe("validateParticles", () => {
  const sentenceIds = new Set(["s_g001"]);

  it("八筆都在時不報錯", () => {
    expect(() => validateParticles(makeParticlesFile(), sentenceIds)).not.toThrow();
  });

  it("senses.example_id 指向不存在的句子被抓", () => {
    const file = makeParticlesFile();
    file.particles[0].senses = [{ label: "sense", example_id: "s_missing" }];
    expect(() => validateParticles(file, sentenceIds)).toThrow(BuildError);
    expect(() => validateParticles(file, sentenceIds)).toThrow(
      /senses\[0\]\.example_id 指向不存在的句子：s_missing/,
    );
  });

  it("cell 不在 46 格內被抓", () => {
    const file = makeParticlesFile();
    file.particles[0].cell = "xx" as ParticlesFile["particles"][number]["cell"];
    expect(() => validateParticles(file, sentenceIds)).toThrow(BuildError);
    expect(() => validateParticles(file, sentenceIds)).toThrow(/cell 不在 46 格內：xx/);
  });

  it("缺少八大助詞之一時被抓", () => {
    const file = makeParticlesFile();
    file.particles.pop();
    expect(() => validateParticles(file, sentenceIds)).toThrow(BuildError);
    expect(() => validateParticles(file, sentenceIds)).toThrow(/particles 未涵蓋全部八大助詞/);
  });

  it("contrast_sets.pairs.sentence_id 指向不存在的句子被抓", () => {
    const file = makeParticlesFile({
      contrast_sets: [
        {
          id: "cs_test",
          particles: ["wa", "ga"],
          title: "t",
          summary: "s",
          pairs: [{ sentence_id: "s_missing", note: "n" }],
          exercise_ids: [],
        },
      ],
    });
    expect(() => validateParticles(file, sentenceIds)).toThrow(BuildError);
    expect(() => validateParticles(file, sentenceIds)).toThrow(
      /pairs\[0\]\.sentence_id 指向不存在的句子：s_missing/,
    );
  });
});

// ---------------------------------------------------------------------------
// Practice exercises (build task 2026-09 step 5, DESIGN.md §8.5)

// s_g001-shaped fixture: 私は学生です -- 2 bunsetsu, tokens[1] ("は") is the
// only particle:true token, tokens[3] ("です") is not.
const EXERCISE_SENTENCE: Sentence = enrichSentence(makeSentenceSeed(), "grammar-seed.json", codec);
const SENTENCES_BY_ID = new Map<string, Sentence>([[EXERCISE_SENTENCE.id, EXERCISE_SENTENCE]]);

function makeArrangeExercise(overrides: Partial<ArrangeExercise> = {}): ArrangeExercise {
  return {
    id: "ax_001",
    type: "arrange",
    sentence_id: EXERCISE_SENTENCE.id,
    prompt_zh: "我是學生。",
    hints: ["動詞放最後"],
    distractors: [],
    verified: true,
    ...overrides,
  };
}

const DEFAULT_CANDIDATES: SwapCandidate[] = [
  { particle_id: "wa", verdict: "natural", translation: "我是學生（主題）", note: "は 標主題" },
  { particle_id: "ga", verdict: "different", translation: "我是學生（焦點）", note: "が 標焦點" },
  { particle_id: "wo", verdict: "invalid", translation: null, note: "です 判斷句沒有受詞" },
];

function makeSwapExercise(overrides: Partial<ParticleSwapExercise> = {}): ParticleSwapExercise {
  return {
    id: "px_001",
    type: "particle-swap",
    sentence_id: EXERCISE_SENTENCE.id,
    slot_token_index: 1, // "は" -- the only particle:true token in EXERCISE_SENTENCE
    focus: ["wa", "ga"],
    candidates: DEFAULT_CANDIDATES,
    verified: true,
    ...overrides,
  };
}

describe("validateExercise", () => {
  const file = "seed.json";

  it("合法的 arrange 練習不報錯", () => {
    expect(() => validateExercise(makeArrangeExercise(), file, SENTENCES_BY_ID)).not.toThrow();
  });

  it("合法的 particle-swap 練習不報錯", () => {
    expect(() => validateExercise(makeSwapExercise(), file, SENTENCES_BY_ID)).not.toThrow();
  });

  it("id 格式不符（非 ax_/px_ 開頭）被抓", () => {
    const exercise = makeArrangeExercise({ id: "z_001" });
    expect(() => validateExercise(exercise, file, SENTENCES_BY_ID)).toThrow(BuildError);
    expect(() => validateExercise(exercise, file, SENTENCES_BY_ID)).toThrow(/id 格式須為 ax_ 或 px_/);
  });

  it("sentence_id 指向不存在的句子被抓", () => {
    const exercise = makeArrangeExercise({ sentence_id: "s_missing" });
    expect(() => validateExercise(exercise, file, SENTENCES_BY_ID)).toThrow(BuildError);
    expect(() => validateExercise(exercise, file, SENTENCES_BY_ID)).toThrow(
      /sentence_id 指向不存在的句子：s_missing/,
    );
  });

  it("arrange：sentence 少於 2 個文節被抓", () => {
    const oneBunsetsu: Sentence = { ...EXERCISE_SENTENCE, id: "s_one", bunsetsu: [[0, 1, 2, 3]] };
    const map = new Map([[oneBunsetsu.id, oneBunsetsu]]);
    const exercise = makeArrangeExercise({ sentence_id: oneBunsetsu.id });
    expect(() => validateExercise(exercise, file, map)).toThrow(BuildError);
    expect(() => validateExercise(exercise, file, map)).toThrow(/少於 2 個文節/);
  });

  it("particle-swap：slot_token_index 指到非助詞 token 被抓（故障注入案例：改指向 tokens[3] 的「です」）", () => {
    const exercise = makeSwapExercise({ slot_token_index: 3 });
    expect(() => validateExercise(exercise, file, SENTENCES_BY_ID)).toThrow(BuildError);
    expect(() => validateExercise(exercise, file, SENTENCES_BY_ID)).toThrow(
      /slot_token_index \(3\) 指向的 token "です" 不是助詞/,
    );
  });

  it("particle-swap：slot_token_index 超出範圍被抓", () => {
    const exercise = makeSwapExercise({ slot_token_index: 99 });
    expect(() => validateExercise(exercise, file, SENTENCES_BY_ID)).toThrow(BuildError);
    expect(() => validateExercise(exercise, file, SENTENCES_BY_ID)).toThrow(/超出句子.*token 範圍/);
  });

  it("particle-swap：候選裡沒有任何 natural 被抓", () => {
    const exercise = makeSwapExercise({
      candidates: DEFAULT_CANDIDATES.map((c) => (c.verdict === "natural" ? { ...c, verdict: "marginal" } : c)),
    });
    expect(() => validateExercise(exercise, file, SENTENCES_BY_ID)).toThrow(BuildError);
    expect(() => validateExercise(exercise, file, SENTENCES_BY_ID)).toThrow(/至少要有一個 natural/);
  });

  it("particle-swap：invalid 候選帶了非 null 的 translation 被抓", () => {
    const exercise = makeSwapExercise({
      candidates: DEFAULT_CANDIDATES.map((c) =>
        c.verdict === "invalid" ? { ...c, translation: "不應該有翻譯" } : c,
      ),
    });
    expect(() => validateExercise(exercise, file, SENTENCES_BY_ID)).toThrow(BuildError);
    expect(() => validateExercise(exercise, file, SENTENCES_BY_ID)).toThrow(
      /verdict 為 invalid 時 translation 必須是 null/,
    );
  });

  it("particle-swap：candidates.particle_id 重複被抓", () => {
    const exercise = makeSwapExercise({
      candidates: [...DEFAULT_CANDIDATES, { ...DEFAULT_CANDIDATES[0] }],
    });
    expect(() => validateExercise(exercise, file, SENTENCES_BY_ID)).toThrow(BuildError);
    expect(() => validateExercise(exercise, file, SENTENCES_BY_ID)).toThrow(/particle_id 重複：wa/);
  });

  it("particle-swap：focus 含未出現在 candidates 裡的助詞 id 被抓", () => {
    const exercise = makeSwapExercise({ focus: ["wa", "ni"] });
    expect(() => validateExercise(exercise, file, SENTENCES_BY_ID)).toThrow(BuildError);
    expect(() => validateExercise(exercise, file, SENTENCES_BY_ID)).toThrow(
      /focus 含未出現在 candidates 裡的助詞 id：ni/,
    );
  });

  it("particle-swap：verdict 不在四值內被抓", () => {
    const exercise = makeSwapExercise({
      candidates: [{ ...DEFAULT_CANDIDATES[0], verdict: "correct" as SwapCandidate["verdict"] }],
    });
    expect(() => validateExercise(exercise, file, SENTENCES_BY_ID)).toThrow(BuildError);
    expect(() => validateExercise(exercise, file, SENTENCES_BY_ID)).toThrow(/verdict 不在四值內/);
  });

  it("arrange：distractors 非空陣列被抓", () => {
    const exercise = makeArrangeExercise({ distractors: ["x"] as unknown as never[] });
    expect(() => validateExercise(exercise, file, SENTENCES_BY_ID)).toThrow(BuildError);
    expect(() => validateExercise(exercise, file, SENTENCES_BY_ID)).toThrow(/distractors 這版必須固定為空陣列/);
  });
});

describe("validateExercises", () => {
  it("跨檔重複 id 被抓", () => {
    const a: RawExercise = { file: "a.json", exercise: makeArrangeExercise({ id: "ax_dup" }) };
    const b: RawExercise = { file: "b.json", exercise: makeArrangeExercise({ id: "ax_dup" }) };
    expect(() => validateExercises([a, b], SENTENCES_BY_ID)).toThrow(BuildError);
    expect(() => validateExercises([a, b], SENTENCES_BY_ID)).toThrow(/id 與 a\.json 重複/);
  });

  it("多筆合法練習不報錯", () => {
    const a: RawExercise = { file: "a.json", exercise: makeArrangeExercise({ id: "ax_a" }) };
    const b: RawExercise = { file: "a.json", exercise: makeSwapExercise({ id: "px_a" }) };
    expect(() => validateExercises([a, b], SENTENCES_BY_ID)).not.toThrow();
  });
});
