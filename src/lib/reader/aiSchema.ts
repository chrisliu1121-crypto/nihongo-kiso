// src/lib/reader/aiSchema.ts — the JSON-schema (sent to OpenRouter as
// response_format.json_schema.schema) and the matching zod schema (used to
// validate the parsed response before analyze.ts trusts it) for one
// per-segment analysis request. Kept as two independent definitions on
// purpose, same split as scripts/lib/ai/openrouter.ts's ENRICH_SCHEMA vs.
// scripts/lib/schemas.ts's EnrichResultSchema -- the JSON schema is what the
// model is constrained by (plain data, `additionalProperties: false`, every
// property in `required`, per OpenRouter's strict-mode contract); the zod
// schema is this app's own runtime re-check of the same shape.

import { z } from "zod";

// ---------------------------------------------------------------------------
// JSON schema for response_format.json_schema.schema (strict: true).

const RAW_TOKEN_SCHEMA = {
  type: "object",
  properties: {
    surface: { type: "string" },
    reading: { type: "string" },
    gloss: { type: "string" },
    particle: { type: ["boolean", "null"] },
  },
  required: ["surface", "reading", "gloss", "particle"],
  additionalProperties: false,
} as const;

const RAW_TRANSLATION_CHUNK_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string" },
    token_indices: { type: "array", items: { type: "integer" } },
  },
  required: ["text", "token_indices"],
  additionalProperties: false,
} as const;

const RAW_SENTENCE_SCHEMA = {
  type: "object",
  properties: {
    tokens: { type: "array", items: RAW_TOKEN_SCHEMA },
    translation: { type: "array", items: RAW_TRANSLATION_CHUNK_SCHEMA },
  },
  required: ["tokens", "translation"],
  additionalProperties: false,
} as const;

const RAW_VOCAB_SCHEMA = {
  type: "object",
  properties: {
    surface: { type: "string" },
    reading: { type: "string" },
    gloss: { type: "string" },
    pos: { type: "string" },
    note: { type: "string" },
  },
  required: ["surface", "reading", "gloss", "pos", "note"],
  additionalProperties: false,
} as const;

const RAW_GRAMMAR_SCHEMA = {
  type: "object",
  properties: {
    pattern: { type: "string" },
    explanation: { type: "string" },
    sentence_index: { type: "integer" },
  },
  required: ["pattern", "explanation", "sentence_index"],
  additionalProperties: false,
} as const;

const RAW_PARTICLE_SCHEMA = {
  type: "object",
  properties: {
    surface: { type: "string" },
    usage: { type: "string" },
    sentence_index: { type: "integer" },
  },
  required: ["surface", "usage", "sentence_index"],
  additionalProperties: false,
} as const;

/** Full JSON schema for one segment's analysis response -- see analyze.ts's buildAnalysisRequestBody. */
export const ANALYSIS_JSON_SCHEMA = {
  type: "object",
  properties: {
    sentences: { type: "array", items: RAW_SENTENCE_SCHEMA },
    extracted: {
      type: "object",
      properties: {
        vocab: { type: "array", items: RAW_VOCAB_SCHEMA },
        grammar: { type: "array", items: RAW_GRAMMAR_SCHEMA },
        particles: { type: "array", items: RAW_PARTICLE_SCHEMA },
      },
      required: ["vocab", "grammar", "particles"],
      additionalProperties: false,
    },
  },
  required: ["sentences", "extracted"],
  additionalProperties: false,
} as const;

// ---------------------------------------------------------------------------
// zod re-statement, used to validate the parsed response before analyze.ts
// trusts it (same discipline as scripts/lib/schemas.ts's EnrichResultSchema).

export const RawTokenSchema = z.object({
  surface: z.string(),
  reading: z.string(),
  gloss: z.string(),
  particle: z.boolean().nullable(),
});

export const RawTranslationChunkSchema = z.object({
  text: z.string(),
  token_indices: z.array(z.number().int()),
});

export const RawSentenceSchema = z.object({
  tokens: z.array(RawTokenSchema),
  translation: z.array(RawTranslationChunkSchema),
});

export const RawVocabSchema = z.object({
  surface: z.string(),
  reading: z.string(),
  gloss: z.string(),
  pos: z.string(),
  note: z.string(),
});

export const RawGrammarSchema = z.object({
  pattern: z.string(),
  explanation: z.string(),
  sentence_index: z.number().int(),
});

export const RawParticleSchema = z.object({
  surface: z.string(),
  usage: z.string(),
  sentence_index: z.number().int(),
});

export const AnalysisResponseSchema = z.object({
  sentences: z.array(RawSentenceSchema),
  extracted: z.object({
    vocab: z.array(RawVocabSchema),
    grammar: z.array(RawGrammarSchema),
    particles: z.array(RawParticleSchema),
  }),
});

export type RawToken = z.infer<typeof RawTokenSchema>;
export type RawTranslationChunk = z.infer<typeof RawTranslationChunkSchema>;
export type RawSentence = z.infer<typeof RawSentenceSchema>;
export type AnalysisResponse = z.infer<typeof AnalysisResponseSchema>;

// ---------------------------------------------------------------------------
// System prompt (traditional Chinese, per-segment). Kept as its own export
// so a test can assert on its text if needed, same convention as
// scripts/lib/ai/openrouter.ts's buildEnrichSystemPrompt.

export const ANALYSIS_SYSTEM_PROMPT = `你是日語文本的逐詞分析器與翻譯器，服務對象是正在學習日語的繁體中文使用者。

規則（全部強制）：
- 只能輸出 JSON 本體，不要用 markdown code fence（\`\`\`json ... \`\`\`）包裹，也不要加任何其他文字。
- 把輸入文字依行拆成句子；每一行視為一句（例如歌詞每一行是一句），一行內若有多個句子可再依句號拆開。
- 每句要逐詞（token）切分：助詞（は、が、を、に、で、と、の、も、へ、か、から、まで、や、ね、よ、でも、には、では、とか等）獨立成一個 token，並標 "particle": true；非助詞 token 的 "particle" 欄位填 null（這個欄位一律要出現，不要省略）。
- 標點符號（。、！？「」『』・…（）—）也各自獨立成一個 token：其 "reading" 為空字串 ""、"gloss" 為空字串 ""、"particle" 為 null。
- 每個非標點 token 的 "reading" 只能是假名（平假名或片假名），不可包含漢字或羅馬字；助詞 は/へ/を 的 reading 照字形寫 は/へ/を，不要寫成 わ/え/お。
- 每個非標點 token 都要有 "gloss"：這個詞「在本句中」的繁體中文意思，簡短為主；助詞的 gloss 用括號說明功能，例如「（主題）」「（受詞）」「（地點）」「（目的地）」「（時間）」「（對象）」。gloss 不可是假名讀音或羅馬字，也不可留空（標點例外，見上）。
- "translation"：把整句的繁體中文翻譯切成幾個片段，依「中文」語序排列（不必和日文語序一致）；每個片段的 "token_indices" 指出它對應日文原句 tokens 陣列裡的哪些 index（從 0 開始）——可以一個 token 對應多個片段，也可以多個 token 對應一個片段；所有片段的 text 依序接起來就是整句的繁體中文翻譯。
- 另外從這段輸入裡擷取常見、值得學的詞彙（"extracted.vocab"，最多 12 個）、文法點（"extracted.grammar"，最多 6 個）、助詞用法（"extracted.particles"，最多 8 個）；"sentence_index" 指這段輸入裡 "sentences" 陣列的 index（從 0 開始）。
- 回傳的 JSON 必須完全符合提供的 schema，不要加上 schema 之外的欄位，也不要省略任何必要欄位。`;
