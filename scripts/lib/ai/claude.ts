// scripts/lib/ai/claude.ts — the real Enricher/Judge, calling the Claude
// API (build task 2026-09 step 6, DESIGN.md §9). This machine has no
// ANTHROPIC_API_KEY, so NOTHING in this file has ever been exercised
// against a live response -- generate-daily.ts / cross-check.ts only
// dynamically `import("./claude.ts")` when `--enricher claude` or
// `--judge claude` is actually passed, specifically so the stub-only path
// (and every test in this repo) never even loads `@anthropic-ai/sdk`.
//
// FIRST TIME THIS RUNS WITH A REAL KEY: use `--dry-run` first (generate-daily.ts's
// own flag -- it never calls enrich()/judge() at all) to sanity-check which
// words/candidates would be sent, THEN run for real. This file's request
// shapes (system prompts, the json_schema output_config, max_tokens) are
// reviewed-but-unverified until that first real call.
//
// Structured output shape verified against the currently-installed
// @anthropic-ai/sdk's own type declarations (node_modules/@anthropic-ai/sdk
// /resources/messages/messages.d.ts): `output_config.format` is
// `{ type: "json_schema", schema: {...} }` (JSONOutputFormat). Review item 3
// added `zod` (already a project dependency by then, for validate-words.ts's
// own schema check) as the runtime validator for the parsed response
// (EnrichResultSchema/JudgeResultSchema in ../schemas.ts) instead of the
// original hand-written type guards.
//
// `particle` is modeled as required-but-nullable (`z.boolean().nullable()`,
// and `type: ["boolean","null"]` + listed in `required` in the raw JSON
// schema below) rather than optional: this repo's own structured-output
// contract requires every property named in a strict schema's `properties`
// to also appear in `required`, so "sometimes absent" has to be spelled
// "always present, possibly null" (review item 3).

import Anthropic from "@anthropic-ai/sdk";
import type { Enricher, EnrichRequest, EnrichResult, EnrichResultToken } from "./enricher.ts";
import type { Judge, JudgeRequest, JudgeResult } from "./judge.ts";
import { EnrichResultSchema, JudgeResultSchema } from "../schemas.ts";
import { AiProviderError } from "./errors.ts";

const MODEL = "claude-opus-5";
const MAX_TOKENS = 8192;

const ENRICH_SCHEMA = {
  type: "object",
  properties: {
    example: {
      type: "object",
      properties: {
        ja: { type: "string" },
        zh: { type: "string" },
        tokens: {
          type: "array",
          items: {
            type: "object",
            properties: {
              surface: { type: "string" },
              reading: { type: "string" },
              gloss: { type: "string" },
              particle: { type: ["boolean", "null"] },
            },
            required: ["surface", "reading", "gloss", "particle"],
            additionalProperties: false,
          },
        },
      },
      required: ["ja", "zh", "tokens"],
      additionalProperties: false,
    },
    collocations: { type: "array", items: { type: "string" } },
    note: { type: ["string", "null"] },
  },
  required: ["example", "collocations", "note"],
  additionalProperties: false,
} as const;

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    natural: { type: "boolean" },
    reading_ok: { type: "boolean" },
    gloss_ok: { type: "boolean" },
    issues: { type: "array", items: { type: "string" } },
  },
  required: ["natural", "reading_ok", "gloss_ok", "issues"],
  additionalProperties: false,
} as const;

const ENRICH_SYSTEM_PROMPT = `你是日語教材的例句產生器，服務對象是 N5 程度的中文母語初學者。

規則（全部強制）：
- 只用 N5 範圍的詞彙與文法；動詞一律用ます形，句子力求簡短（一個子句，不超過一個接續）。
- 例句必須逐字拆成 tokens；每個助詞（は/が/を/に/で/と/の/も/へ/か/から/まで/や/ね/よ/でも/には/では/とか）獨立成一個 token，並標 "particle": true；非助詞 token 的 "particle" 欄位請填 null（這個欄位一律要出現，不是助詞就填 null，不要省略）。
- 標點符號（。、）只能出現在 "ja" 欄位，絕對不可出現在任何 token 的 surface 或 reading 裡。
- "ja" 欄位必須恰好等於全部 tokens.surface 依序串接後，再加上句尾標點——不多字、不少字。
- reading 欄位只能是假名（平假名或片假名），不可包含漢字或羅馬字。
- 助詞 は/へ/を 的 reading 照字形寫 は/へ/を，不要寫成 わ/え/お（發音由 "particle": true 處理）；其他純假名 token 的 reading 也必須與 surface 是同一組假名。
- 每個 token 都必須附 "gloss"：這個詞「在本句中」的繁體中文意思，力求簡短（1–4 字為主）；動詞寫句中活用後的意思（例：食べます → 吃；行きたい → 想去）；「です」寫「是」；助詞寫括號功能說明，例如「（主題）」「（主語）」「（受詞）」「（地點）」「（目的地）」「（時間）」「（對象）」「（和）」「（的）」「（也）」「（疑問）」。gloss 絕對不可寫假名讀音或羅馬字，也不可留空。
- 完整 token 範例（例句「学校に行きます。」）：[{"surface": "学校", "reading": "がっこう", "gloss": "學校", "particle": null}, {"surface": "に", "reading": "に", "gloss": "（目的地）", "particle": true}, {"surface": "行きます", "reading": "いきます", "gloss": "去", "particle": null}]
- 盡量避免產生與 existing_surfaces 裡列出的例句幾乎相同的句子（換個場景或搭配）。
- 回傳的 JSON 必須完全符合提供的 schema，不要加上 schema 之外的欄位。`;

const JUDGE_SYSTEM_PROMPT = `你是日語教材的獨立審查者。你只會看到一個詞與它的例句候選，看不到任何人（或其他 AI）對這個候選的理由或判斷——請完全獨立判讀，不要猜測別人怎麼想。

檢查五件事：
1. natural：這個例句作為 N5 教材是否自然、合乎文法。
2. reading_ok：reading 是否是這個 surface 正確的假名讀音。
3. gloss_ok：中文翻譯（zh／gloss）是否對應日文原意；並逐一檢查例句 example.tokens 中每個 token 的 gloss——是否正確表達該詞「在本句中」的意思（動詞看句中活用、助詞應為括號功能說明如「（主題）」「（受詞）」）、是否為繁體中文（不可是假名讀音、羅馬字、簡體字或空白）。任何一個 token 的 gloss 有誤都要把 gloss_ok 判為 false，並在 issues 指出是哪個 token。
4. 例句是否整句都在 N5 範圍內用詞與文法——出現任何超出 N5 的詞彙、文法點、或非常見漢字，都要在 issues 說明並把 natural 判為 false。
5. 例句是否與 existing_examples 裡列出的既有例句雷同（幾乎相同的句型、場景、用字）——雷同時在 issues 註明，並把 natural 判為 false，即使文法本身沒問題。

重要判準：如果把某個助詞換成另一個助詞後，句子仍然文法成立、只是意思變了（不是不成立），那不算錯誤——這是另一個同樣成立的句子，不能因為「不是原本要教的那個助詞」就判 natural: false。只有真正不成立、用詞/讀音錯誤、超出 N5 範圍、或與既有例句雷同時才判 false，並在 issues 說明。

回傳的 JSON 必須完全符合提供的 schema。`;

/** Pull the JSON text out of a Message's content blocks (the first text block, per output_config's contract). */
function extractJsonText(message: Anthropic.Message): string {
  const textBlock = message.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock) {
    throw new AiProviderError("claude", "schema", "Claude 回應沒有任何 text block，無法解析 JSON");
  }
  return textBlock.text;
}

/**
 * Review item 4: inspect `stop_reason` BEFORE trusting/parsing the
 * response body at all. A non-"end_turn" stop can mean the JSON is
 * missing, truncated, or was never produced in the first place --
 * attempting to JSON.parse it anyway would surface as a confusing parse
 * error instead of the actual cause.
 *   - "refusal": the model declined to answer. Print the policy category
 *     (`message.stop_details.category`) when the API supplied one, and
 *     exit(2) -- there is no content to recover here.
 *   - "max_tokens": the response was cut off before finishing the JSON
 *     object. Exit(2) with a message pointing at MAX_TOKENS, since
 *     retrying with the same request would just truncate again.
 *   - anything else non-"end_turn" (stop_sequence / tool_use / pause_turn /
 *     model_context_window_exceeded): none of these are expected for this
 *     request shape (no tools, no stop sequences configured), so just log
 *     it loudly -- something about the request or the API changed in a way
 *     worth noticing, but the content might still be parseable.
 */
// Code review item 1 (P0): the two failure branches below used to call
// process.exit(2) directly. Both are per-call failures (this specific
// word's output was refused or truncated), not a setup problem, so they now
// throw AiProviderError instead -- see errors.ts's file header for the full
// rationale (a mid-batch failure must leave the caller able to record this
// one word and keep going, not kill the whole process).
//   - "refusal": the model declined to answer. kind: "refusal".
//   - "max_tokens": the response was cut off before finishing the JSON
//     object. kind: "truncated".
//   - anything else non-"end_turn" (stop_sequence / tool_use / pause_turn /
//     model_context_window_exceeded): none of these are expected for this
//     request shape (no tools, no stop sequences configured), so just log
//     it loudly -- something about the request or the API changed in a way
//     worth noticing, but the content might still be parseable.
function checkStopReason(message: Anthropic.Message): void {
  if (message.stop_reason === "end_turn") return;

  if (message.stop_reason === "refusal") {
    const category = message.stop_details?.category ?? "(無 category)";
    throw new AiProviderError("claude", "refusal", `回應被拒絕（stop_reason: refusal），category=${category}`);
  }

  if (message.stop_reason === "max_tokens") {
    throw new AiProviderError("claude", "truncated", `輸出被截斷，MAX_TOKENS (${MAX_TOKENS}) 不足`);
  }

  console.error(`[claude] 非預期的 stop_reason：${message.stop_reason}`);
}

/**
 * Code review item 1 (P0): translate whatever enrich()/judge()'s try block
 * threw into either (a) process.exit(2) -- ONLY for the one case that's a
 * local misconfiguration rather than a per-word failure (no usable
 * ANTHROPIC_API_KEY at all, detected before any request is even sent), or
 * (b) a re-thrown/wrapped AiProviderError for everything else, so the
 * caller (generate-daily.ts's enrich loop) can catch it, record this one
 * word into pipeline.errors, and keep going instead of losing the whole
 * batch. DESIGN.md's pipeline never silently falls back to the stub
 * backend when the real one was explicitly requested -- a silent downgrade
 * here would look like success while producing no output, exactly the kind
 * of "failure that doesn't fail loud" this whole build task's brief calls
 * out as the wrong direction; throwing AiProviderError keeps that property
 * (the caller MUST look at it, it can't be silently ignored) while still
 * letting the batch continue.
 */
function handleClaudeError(err: unknown): never {
  // checkStopReason above already throws a fully-formed AiProviderError --
  // pass it straight through rather than re-wrapping it.
  if (err instanceof AiProviderError) {
    throw err;
  }

  const isMissingAuthConfig = err instanceof Error && err.message.includes("Could not resolve authentication method");
  if (isMissingAuthConfig) {
    // The SDK throws this plain client-side Error before any request is
    // even sent when ANTHROPIC_API_KEY isn't set at all -- a local
    // misconfiguration, not a per-word failure a pending-file retry could
    // ever fix. Stays process.exit(2), exactly as before.
    console.error(
      "[claude] 驗證失敗：沒有有效的 ANTHROPIC_API_KEY（環境變數未設定）。" +
        "這台機器目前沒有 key，--enricher claude / --judge claude 無法使用。",
    );
    process.exit(2);
  }

  if (err instanceof Anthropic.AuthenticationError) {
    // Unlike isMissingAuthConfig above, this means a request DID go out
    // with a key the server rejected (HTTP 401) -- a per-call failure like
    // any other, not a setup problem, so it throws instead of exiting.
    throw new AiProviderError("claude", "auth", err.message, err.status);
  }

  if (err instanceof Anthropic.APIError) {
    throw new AiProviderError("claude", err.status === undefined ? "network" : "http", err.message, err.status);
  }

  throw new AiProviderError("claude", "network", err instanceof Error ? err.message : String(err));
}

let sharedClient: Anthropic | null = null;
function getClient(): Anthropic {
  if (!sharedClient) sharedClient = new Anthropic();
  return sharedClient;
}

export const ClaudeEnricher: Enricher = {
  name: "claude",
  async enrich(req: EnrichRequest): Promise<EnrichResult> {
    const userContent = JSON.stringify({
      surface: req.surface,
      reading: req.reading,
      gloss: req.gloss,
      pos: req.pos,
      level: req.level,
      existing_surfaces: req.existing_surfaces,
    });

    try {
      const client = getClient();
      const messages: Anthropic.MessageParam[] = [{ role: "user", content: userContent }];
      const message = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: ENRICH_SYSTEM_PROMPT,
        messages,
        output_config: { format: { type: "json_schema", schema: ENRICH_SCHEMA } },
      });

      checkStopReason(message);

      const parsedJson: unknown = JSON.parse(extractJsonText(message));
      const result = EnrichResultSchema.safeParse(parsedJson);
      if (!result.success) {
        throw new AiProviderError("claude", "schema", `Claude 回傳的 JSON 不符合 EnrichResult schema：${result.error.message}`);
      }
      // result.data.example.tokens[].particle is required-but-nullable
      // (see file header); EnrichResultToken (the internal shape every
      // other caller in this codebase uses) keeps `particle` OPTIONAL --
      // only `true` is ever meaningfully checked anywhere downstream
      // (validate-words.ts's `if (token.particle && ...)`), so null/false
      // collapse to "absent" here.
      const tokens: EnrichResultToken[] = result.data.example.tokens.map((t) => ({
        surface: t.surface,
        reading: t.reading,
        gloss: t.gloss,
        ...(t.particle === true ? { particle: true as const } : {}),
      }));
      return { example: { ...result.data.example, tokens }, collocations: result.data.collocations, note: result.data.note };
    } catch (err) {
      handleClaudeError(err);
    }
  },
};

export const ClaudeJudge: Judge = {
  name: "claude",
  async judge(req: JudgeRequest): Promise<JudgeResult> {
    const userContent = JSON.stringify({
      surface: req.surface,
      reading: req.reading,
      gloss: req.gloss,
      example: req.example,
      existing_examples: req.existing_examples,
    });

    try {
      const client = getClient();
      const messages: Anthropic.MessageParam[] = [{ role: "user", content: userContent }];
      const message = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: JUDGE_SYSTEM_PROMPT,
        messages,
        output_config: { format: { type: "json_schema", schema: JUDGE_SCHEMA } },
      });

      checkStopReason(message);

      const parsedJson: unknown = JSON.parse(extractJsonText(message));
      const result = JudgeResultSchema.safeParse(parsedJson);
      if (!result.success) {
        throw new AiProviderError("claude", "schema", `Claude 回傳的 JSON 不符合 JudgeResult schema：${result.error.message}`);
      }
      return result.data;
    } catch (err) {
      handleClaudeError(err);
    }
  },
};
