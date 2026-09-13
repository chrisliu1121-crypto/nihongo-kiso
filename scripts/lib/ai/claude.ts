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
              particle: { type: ["boolean", "null"] },
            },
            required: ["surface", "reading", "particle"],
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
- 盡量避免產生與 existing_surfaces 裡列出的例句幾乎相同的句子（換個場景或搭配）。
- 回傳的 JSON 必須完全符合提供的 schema，不要加上 schema 之外的欄位。`;

const JUDGE_SYSTEM_PROMPT = `你是日語教材的獨立審查者。你只會看到一個詞與它的例句候選，看不到任何人（或其他 AI）對這個候選的理由或判斷——請完全獨立判讀，不要猜測別人怎麼想。

檢查五件事：
1. natural：這個例句作為 N5 教材是否自然、合乎文法。
2. reading_ok：reading 是否是這個 surface 正確的假名讀音。
3. gloss_ok：中文翻譯（zh／gloss）是否對應日文原意。
4. 例句是否整句都在 N5 範圍內用詞與文法——出現任何超出 N5 的詞彙、文法點、或非常見漢字，都要在 issues 說明並把 natural 判為 false。
5. 例句是否與 existing_examples 裡列出的既有例句雷同（幾乎相同的句型、場景、用字）——雷同時在 issues 註明，並把 natural 判為 false，即使文法本身沒問題。

重要判準：如果把某個助詞換成另一個助詞後，句子仍然文法成立、只是意思變了（不是不成立），那不算錯誤——這是另一個同樣成立的句子，不能因為「不是原本要教的那個助詞」就判 natural: false。只有真正不成立、用詞/讀音錯誤、超出 N5 範圍、或與既有例句雷同時才判 false，並在 issues 說明。

回傳的 JSON 必須完全符合提供的 schema。`;

/** Pull the JSON text out of a Message's content blocks (the first text block, per output_config's contract). */
function extractJsonText(message: Anthropic.Message): string {
  const textBlock = message.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock) {
    throw new Error("Claude 回應沒有任何 text block，無法解析 JSON");
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
function checkStopReason(message: Anthropic.Message): void {
  if (message.stop_reason === "end_turn") return;

  if (message.stop_reason === "refusal") {
    const category = message.stop_details?.category ?? "(無 category)";
    console.error(`[claude] 回應被拒絕（stop_reason: refusal），category=${category}`);
    process.exit(2);
  }

  if (message.stop_reason === "max_tokens") {
    console.error(`[claude] 輸出被截斷，MAX_TOKENS (${MAX_TOKENS}) 不足`);
    process.exit(2);
  }

  console.error(`[claude] 非預期的 stop_reason：${message.stop_reason}`);
}

/**
 * No API key, or any other SDK-level failure: print a clear message and
 * exit(2) immediately. DESIGN.md's pipeline never silently falls back to
 * the stub backend when the real one was explicitly requested -- a
 * silent downgrade here would look like success while producing no
 * output, exactly the kind of "failure that doesn't fail loud" this whole
 * build task's brief calls out as the wrong direction.
 */
function dieOnClaudeError(err: unknown): never {
  const isMissingAuthConfig = err instanceof Error && err.message.includes("Could not resolve authentication method");
  if (err instanceof Anthropic.AuthenticationError || isMissingAuthConfig) {
    // The SDK throws two different shapes for "no usable credentials": a
    // plain client-side Error before any request is even sent when
    // ANTHROPIC_API_KEY isn't set at all (isMissingAuthConfig -- this
    // machine's actual case), or an AuthenticationError (HTTP 401) once a
    // request DID go out with a key the server rejected. Both mean the same
    // thing to an operator running this script, so both get the same
    // message.
    console.error(
      "[claude] 驗證失敗：沒有有效的 ANTHROPIC_API_KEY（環境變數未設定，或金鑰無效）。" +
        "這台機器目前沒有 key，--enricher claude / --judge claude 無法使用。",
    );
  } else if (err instanceof Anthropic.APIError) {
    console.error(`[claude] API 錯誤（status ${err.status ?? "?"}）：${err.message}`);
  } else {
    console.error("[claude] 呼叫失敗：", err);
  }
  process.exit(2);
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
        throw new Error(`Claude 回傳的 JSON 不符合 EnrichResult schema：${result.error.message}`);
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
        ...(t.particle === true ? { particle: true as const } : {}),
      }));
      return { example: { ...result.data.example, tokens }, collocations: result.data.collocations, note: result.data.note };
    } catch (err) {
      dieOnClaudeError(err);
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
        throw new Error(`Claude 回傳的 JSON 不符合 JudgeResult schema：${result.error.message}`);
      }
      return result.data;
    } catch (err) {
      dieOnClaudeError(err);
    }
  },
};
