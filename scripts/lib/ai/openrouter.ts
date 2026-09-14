// scripts/lib/ai/openrouter.ts — the real Enricher/Judge, calling OpenRouter's
// OpenAI-compatible chat-completions API with nothing but the built-in
// `fetch` (no new npm dependency). This machine has no OPENROUTER_API_KEY,
// so NOTHING in this file has ever been exercised against a live response --
// generate-daily.ts / cross-check.ts only dynamically
// `import("./openrouter.ts")` when `--enricher openrouter` or
// `--judge openrouter` is actually passed. The real API will only be
// exercised later in GitHub Actions.
//
// This file must NEVER import anything from claude.ts (including the system
// prompt strings) -- claude.ts has a static top-of-file import of the
// Anthropic SDK package, and importing anything from it would drag the SDK
// in transitively, breaking the "SDK only loads when claude is explicitly
// selected" isolation guarantee
// (scripts/lib/ai/__tests__/no-sdk-on-stub-path.test.ts). The system prompts
// and JSON-schema instructional strings are provider-agnostic business
// rules, not Claude-specific -- they're copied verbatim below as a separate
// copy, not shared.
//
// FIRST TIME THIS RUNS WITH A REAL KEY: use `--dry-run` first (generate-daily.ts's
// own flag -- it never calls enrich()/judge() at all, see generate-daily.ts's
// main(): the `--dry-run` branch returns before resolveEnricher/resolveJudge
// are ever called) to sanity-check which words/candidates would be sent,
// THEN run for real. This file's request shapes (system prompts, the
// response_format json_schema, max_tokens, headers) were checked against
// OpenRouter's official docs (the "Structured Outputs" and
// "Chat Completion" API reference pages: response_format.type ==
// "json_schema" with a nested json_schema.{name,strict,schema} object;
// Authorization/HTTP-Referer/X-Title headers) but are reviewed-but-unverified
// against a live response until that first real call -- `strict: true`
// actually being honored depends on the underlying provider/model OpenRouter
// routes the request to; it is not guaranteed for every endpoint.

import type { Enricher, EnrichRequest, EnrichResult, EnrichResultToken } from "./enricher.ts";
import type { Judge, JudgeRequest, JudgeResult } from "./judge.ts";
import { EnrichResultSchema, JudgeResultSchema } from "../schemas.ts";
import { AiProviderError } from "./errors.ts";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

// Swappable later -- see file header. OPENROUTER_MODEL env var or --model
// CLI flag (wired in generate-daily.ts/cross-check.ts) overrides this.
// Code review item 2 (P0): the previous default ("anthropic/claude-sonnet-4.6")
// doesn't exist on OpenRouter (confirmed against GET /api/v1/models) --
// every real call with the old default would have failed. See also
// preflightOpenRouterModel() below, which now checks the resolved model id
// against the live model list before any per-word call is made, so a bad
// override fails loud at startup instead of on the first word.
export const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-fable-5.1";
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

// Copied verbatim from claude.ts (see file header for why this is a
// separate copy, not a shared import). The one addition specific to this
// provider: an explicit "only output JSON, no markdown fences" instruction,
// since OpenRouter's docs don't guarantee fence-free output the way
// Anthropic's dedicated json_schema output_config does -- stripFence()
// below defends against it anyway even with this instruction in place.
const ENRICH_SYSTEM_PROMPT = `你是日語教材的例句產生器，服務對象是 N5 程度的中文母語初學者。

規則（全部強制）：
- 只用 N5 範圍的詞彙與文法；動詞一律用ます形，句子力求簡短（一個子句，不超過一個接續）。
- 例句必須逐字拆成 tokens；每個助詞（は/が/を/に/で/と/の/も/へ/か/から/まで/や/ね/よ/でも/には/では/とか）獨立成一個 token，並標 "particle": true；非助詞 token 的 "particle" 欄位請填 null（這個欄位一律要出現，不是助詞就填 null，不要省略）。
- 標點符號（。、）只能出現在 "ja" 欄位，絕對不可出現在任何 token 的 surface 或 reading 裡。
- "ja" 欄位必須恰好等於全部 tokens.surface 依序串接後，再加上句尾標點——不多字、不少字。
- reading 欄位只能是假名（平假名或片假名），不可包含漢字或羅馬字。
- 盡量避免產生與 existing_surfaces 裡列出的例句幾乎相同的句子（換個場景或搭配）。
- 回傳的 JSON 必須完全符合提供的 schema，不要加上 schema 之外的欄位。
- 只能輸出 JSON 本體，不要用 markdown code fence（\`\`\`json ... \`\`\`）包裹，也不要加任何其他文字。`;

const JUDGE_SYSTEM_PROMPT = `你是日語教材的獨立審查者。你只會看到一個詞與它的例句候選，看不到任何人（或其他 AI）對這個候選的理由或判斷——請完全獨立判讀，不要猜測別人怎麼想。

檢查五件事：
1. natural：這個例句作為 N5 教材是否自然、合乎文法。
2. reading_ok：reading 是否是這個 surface 正確的假名讀音。
3. gloss_ok：中文翻譯（zh／gloss）是否對應日文原意。
4. 例句是否整句都在 N5 範圍內用詞與文法——出現任何超出 N5 的詞彙、文法點、或非常見漢字，都要在 issues 說明並把 natural 判為 false。
5. 例句是否與 existing_examples 裡列出的既有例句雷同（幾乎相同的句型、場景、用字）——雷同時在 issues 註明，並把 natural 判為 false，即使文法本身沒問題。

重要判準：如果把某個助詞換成另一個助詞後，句子仍然文法成立、只是意思變了（不是不成立），那不算錯誤——這是另一個同樣成立的句子，不能因為「不是原本要教的那個助詞」就判 natural: false。只有真正不成立、用詞/讀音錯誤、超出 N5 範圍、或與既有例句雷同時才判 false，並在 issues 說明。

回傳的 JSON 必須完全符合提供的 schema。只能輸出 JSON 本體，不要用 markdown code fence（\`\`\`json ... \`\`\`）包裹，也不要加任何其他文字。`;

// ---------------------------------------------------------------------------
// Pure/testable helpers (scripts/lib/ai/__tests__/openrouter.test.ts
// exercises these directly, with no network involved).

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

interface ChatRequestBody {
  model: string;
  messages: ChatMessage[];
  response_format: {
    type: "json_schema";
    json_schema: {
      name: string;
      strict: true;
      schema: unknown;
    };
  };
  temperature: 0;
  max_tokens: number;
}

function userContentForEnrich(req: EnrichRequest): string {
  return JSON.stringify({
    surface: req.surface,
    reading: req.reading,
    gloss: req.gloss,
    pos: req.pos,
    level: req.level,
    existing_surfaces: req.existing_surfaces,
  });
}

function userContentForJudge(req: JudgeRequest): string {
  return JSON.stringify({
    surface: req.surface,
    reading: req.reading,
    gloss: req.gloss,
    example: req.example,
    existing_examples: req.existing_examples,
  });
}

/** Build the request body for an enrich call (pure -- no network, no env reads). */
export function buildEnrichRequestBody(req: EnrichRequest, model: string): ChatRequestBody {
  return {
    model,
    messages: [
      { role: "system", content: ENRICH_SYSTEM_PROMPT },
      { role: "user", content: userContentForEnrich(req) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "enrich_result", strict: true, schema: ENRICH_SCHEMA },
    },
    temperature: 0,
    max_tokens: MAX_TOKENS,
  };
}

/** Build the request body for a judge call (pure -- no network, no env reads). */
export function buildJudgeRequestBody(req: JudgeRequest, model: string): ChatRequestBody {
  return {
    model,
    messages: [
      { role: "system", content: JUDGE_SYSTEM_PROMPT },
      { role: "user", content: userContentForJudge(req) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "judge_result", strict: true, schema: JUDGE_SCHEMA },
    },
    temperature: 0,
    max_tokens: MAX_TOKENS,
  };
}

/** Strip a ```json ... ``` or ``` ... ``` markdown fence wrapping `s`, if present. Defensive-only: the system prompt already asks for fence-free output (see ENRICH_SYSTEM_PROMPT/JUDGE_SYSTEM_PROMPT), but OpenRouter's docs don't guarantee it. */
export function stripFence(s: string): string {
  const trimmed = s.trim();
  const fenceMatch = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(trimmed);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

/** Pull `{ content, finish_reason }` out of an OpenAI-compatible chat-completions response body (unlike Anthropic's content-block array, OpenRouter's `message.content` is a plain string). Throws a descriptive error if the response doesn't have the expected shape. */
export function parseCompletion(json: unknown): { content: string; finish_reason: string } {
  const obj = json as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }> };
  const choice = obj?.choices?.[0];
  if (!choice || typeof choice.message?.content !== "string" || typeof choice.finish_reason !== "string") {
    throw new Error("OpenRouter 回應沒有預期的 choices[0].message.content / finish_reason 欄位，無法解析");
  }
  return { content: choice.message.content, finish_reason: choice.finish_reason };
}

// ---------------------------------------------------------------------------
// finish_reason handling -- mirrors claude.ts's checkStopReason: inspect
// BEFORE trusting/parsing the response body. OpenAI-style finish_reason
// values: "stop" (normal), "length" (truncated by max_tokens),
// "content_filter" (moderation), "tool_calls"/others (not expected for this
// request shape -- log loudly but keep going, same tolerance claude.ts has
// for unexpected stop_reason values).
function checkFinishReason(finishReason: string): void {
  if (finishReason === "stop") return;

  // Code review item 1 (P0): these two used to be process.exit(2) directly.
  // Both are per-call failures (this specific word's output was truncated
  // or refused), not a setup problem -- throw AiProviderError so the caller
  // (generate-daily.ts's enrich loop) can record this word into
  // pipeline.errors and keep going instead of losing the whole batch.
  if (finishReason === "length") {
    throw new AiProviderError("openrouter", "truncated", `輸出被截斷（finish_reason: length），MAX_TOKENS (${MAX_TOKENS}) 不足`);
  }

  if (finishReason === "content_filter") {
    throw new AiProviderError("openrouter", "refusal", "回應被內容過濾器擋下（finish_reason: content_filter）");
  }

  // Not expected for this request shape, but not fatal either -- log loudly
  // and keep going (same tolerance as before).
  console.error(`[openrouter] 非預期的 finish_reason：${finishReason}`);
}

// ---------------------------------------------------------------------------
// HTTP call. `fetchImpl` defaults to the global `fetch` but is injectable so
// tests never touch the real network (scripts/lib/ai/__tests__/openrouter.test.ts).

type FetchLike = typeof fetch;

function resolveModel(cliModel: string | undefined): string {
  return cliModel ?? process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL;
}

/**
 * No API key: print a clear message and exit(2) immediately, same "fail
 * loud, never silently downgrade" rule claude.ts's dieOnClaudeError follows.
 * This check happens at the START of enrich()/judge() (i.e. only once a
 * network call is actually about to be made) rather than at module load or
 * object-construction time, specifically so `--dry-run` -- which returns
 * before resolveEnricher/resolveJudge are ever called (see
 * generate-daily.ts's main()) -- never needs a key at all.
 */
function requireApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.error("[openrouter] 驗證失敗：缺少 OPENROUTER_API_KEY");
    process.exit(2);
  }
  return key;
}

/**
 * Code review item 3 (P1) defense-in-depth: replace every occurrence of the
 * actual resolved API key inside `text` with "[REDACTED]" before it's ever
 * printed/embedded in an error. The request itself never echoes the key
 * back (this only ever runs over response-body text), but a redaction step
 * costs nothing and removes any dependence on that assumption staying true.
 */
function redactSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join("[REDACTED]");
}

/**
 * POST `body` to OpenRouter's chat-completions endpoint and return the
 * parsed+validated result. Throws AiProviderError on any per-call failure
 * (non-2xx HTTP, network error, bad JSON, schema mismatch) -- see
 * errors.ts's file header for why this is a throw now and not
 * process.exit(2) (code review item 1, P0): a mid-batch failure here must
 * leave the caller (generate-daily.ts's enrich loop) able to record this
 * one word and keep going, not kill the whole process. Only ever puts safe
 * fields into that error: HTTP status and (at most) the first 300 chars of
 * the response BODY, redacted (item 3) -- never the Authorization header,
 * never the request body (which would echo the key's own header context),
 * never the key itself.
 */
async function callOpenRouter(body: ChatRequestBody, fetchImpl: FetchLike): Promise<{ content: string; finish_reason: string }> {
  const key = requireApiKey();

  let response: Response;
  try {
    response = await fetchImpl(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_REFERER ?? "https://github.com/nihongo-kiso",
        // Code review item 4 (P1): send both attribution headers -- X-Title
        // is OpenRouter's documented header, X-OpenRouter-Title is added
        // alongside it (not a replacement) per the review's request.
        "X-Title": "nihongo-kiso",
        "X-OpenRouter-Title": "nihongo-kiso",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new AiProviderError("openrouter", "network", `網路請求失敗：${err instanceof Error ? err.message : String(err)}`);
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "(無法讀取回應內容)");
    const snippet = redactSecret(bodyText.slice(0, 300), key);
    if (response.status === 401) {
      throw new AiProviderError("openrouter", "auth", `OPENROUTER_API_KEY 無效（HTTP 401）：${snippet}`, response.status);
    }
    throw new AiProviderError("openrouter", "http", `API 錯誤（status ${response.status}）：${snippet}`, response.status);
  }

  const json: unknown = await response.json();
  const completion = parseCompletion(json);
  checkFinishReason(completion.finish_reason);
  return completion;
}

function parseContent(content: string): unknown {
  return JSON.parse(stripFence(content));
}

/**
 * Code review item 2 (P0) preflight: before any per-word enrich/judge call
 * is made with the openrouter provider (and only outside --dry-run, since
 * --dry-run never calls resolveEnricher/resolveJudge at all), confirm the
 * resolved model id actually exists on OpenRouter by hitting the (unauthed)
 * models list endpoint. Catches a bad --model / OPENROUTER_MODEL / default
 * loud at startup instead of failing confusingly on the very first word.
 *
 * Ordering is deliberate and load-bearing: requireApiKey() runs FIRST,
 * synchronously, before any fetch is attempted -- so on a machine with no
 * OPENROUTER_API_KEY *and* no network access, this still exits(2) with the
 * missing-key message immediately, the same as it always has, instead of
 * hanging or failing with a confusing network error from the models call
 * (verified empirically -- see the task's required manual repro).
 */
export async function preflightOpenRouterModel(cliModel: string | undefined, fetchImpl: FetchLike = fetch): Promise<void> {
  requireApiKey();
  const model = resolveModel(cliModel);

  let response: Response;
  try {
    response = await fetchImpl(OPENROUTER_MODELS_URL, { method: "GET" });
  } catch (err) {
    console.error(`[openrouter] 無法取得模型列表（${OPENROUTER_MODELS_URL}）：${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "(無法讀取回應內容)");
    console.error(`[openrouter] 無法取得模型列表（status ${response.status}）：${bodyText.slice(0, 300)}`);
    process.exit(2);
  }

  const json: unknown = await response.json();
  const ids = extractModelIds(json);
  if (!ids.includes(model)) {
    const anthropicIds = ids.filter((id) => id.startsWith("anthropic/"));
    console.error(`模型不存在，可用的 anthropic/ 開頭 id 有：${anthropicIds.join(", ")}`);
    process.exit(2);
  }
}

/** Pull `data[].id` out of OpenRouter's `GET /api/v1/models` response body. Tolerant of an unexpected shape -- returns an empty list rather than throwing, so a malformed-but-200 response still reads as "model not found" (fails loud) instead of crashing on a property access. */
function extractModelIds(json: unknown): string[] {
  const obj = json as { data?: unknown };
  if (!Array.isArray(obj?.data)) return [];
  return obj.data
    .filter((m): m is { id: string } => typeof (m as { id?: unknown })?.id === "string")
    .map((m) => m.id);
}

export interface OpenRouterOptions {
  /** Overrides OPENROUTER_MODEL / DEFAULT_OPENROUTER_MODEL (e.g. from --model). */
  model?: string;
  /** Injectable for tests -- defaults to the global fetch. */
  fetchImpl?: FetchLike;
}

export function makeOpenRouterEnricher(opts: OpenRouterOptions = {}): Enricher {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    name: "openrouter",
    async enrich(req: EnrichRequest): Promise<EnrichResult> {
      const model = resolveModel(opts.model);
      const body = buildEnrichRequestBody(req, model);
      const completion = await callOpenRouter(body, fetchImpl);

      let parsedJson: unknown;
      try {
        parsedJson = parseContent(completion.content);
      } catch (err) {
        throw new AiProviderError("openrouter", "schema", `OpenRouter 回應不是合法 JSON：${err instanceof Error ? err.message : String(err)}`);
      }
      const result = EnrichResultSchema.safeParse(parsedJson);
      if (!result.success) {
        throw new AiProviderError("openrouter", "schema", `OpenRouter 回傳的 JSON 不符合 EnrichResult schema：${result.error.message}`);
      }
      // See claude.ts's own enrich() for why this collapses null/false to
      // "absent" -- EnrichResultToken keeps `particle` OPTIONAL, only `true`
      // is ever meaningfully checked downstream.
      const tokens: EnrichResultToken[] = result.data.example.tokens.map((t) => ({
        surface: t.surface,
        reading: t.reading,
        ...(t.particle === true ? { particle: true as const } : {}),
      }));
      return { example: { ...result.data.example, tokens }, collocations: result.data.collocations, note: result.data.note };
    },
  };
}

export function makeOpenRouterJudge(opts: OpenRouterOptions = {}): Judge {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    name: "openrouter",
    async judge(req: JudgeRequest): Promise<JudgeResult> {
      const model = resolveModel(opts.model);
      const body = buildJudgeRequestBody(req, model);
      const completion = await callOpenRouter(body, fetchImpl);

      let parsedJson: unknown;
      try {
        parsedJson = parseContent(completion.content);
      } catch (err) {
        throw new AiProviderError("openrouter", "schema", `OpenRouter 回應不是合法 JSON：${err instanceof Error ? err.message : String(err)}`);
      }
      const result = JudgeResultSchema.safeParse(parsedJson);
      if (!result.success) {
        throw new AiProviderError("openrouter", "schema", `OpenRouter 回傳的 JSON 不符合 JudgeResult schema：${result.error.message}`);
      }
      return result.data;
    },
  };
}

/** Default-constructed provider objects, matching claude.ts's exported ClaudeEnricher/ClaudeJudge shape (plain objects, `name` field) -- used when no --model override is needed. Callers that need --model (generate-daily.ts/cross-check.ts) use makeOpenRouterEnricher/makeOpenRouterJudge directly instead. */
export const OpenRouterEnricher: Enricher = makeOpenRouterEnricher();
export const OpenRouterJudge: Judge = makeOpenRouterJudge();
