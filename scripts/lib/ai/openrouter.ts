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
export const DEFAULT_OPENROUTER_MODEL = "google/gemini-3.8-flash";
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

// Copied verbatim from claude.ts (see file header for why this is a
// separate copy, not a shared import). The one addition specific to this
// provider: an explicit "only output JSON, no markdown fences" instruction,
// since OpenRouter's docs don't guarantee fence-free output the way
// Anthropic's dedicated json_schema output_config does -- stripFence()
// below defends against it anyway even with this instruction in place.
const ENRICH_SYSTEM_PROMPT_BASE = `你是日語教材的例句產生器，服務對象是 N5 程度的中文母語初學者。

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
- 回傳的 JSON 必須完全符合提供的 schema，不要加上 schema 之外的欄位。
- 只能輸出 JSON 本體，不要用 markdown code fence（\`\`\`json ... \`\`\`）包裹，也不要加任何其他文字。`;

// ---------------------------------------------------------------------------
// 2026-09-17 "卡死" fix (DESIGN.md §9.1 "逐詞重試與替補"): the enrich system
// prompt is now built PER REQUEST instead of being one static string --
// allowed_kanji and feedback both vary per call, and both need to be spelled
// out in plain instructional text (not just tucked into the user JSON
// payload) so the model actually reads and follows them. The base rules
// above stay exactly the same static string (existing prompt-content tests
// assert against ENRICH_SYSTEM_PROMPT_BASE's text verbatim); only the two
// clauses below are appended, and only when they have something to say.

/** Always appended: tells the model which kanji its example is allowed to use in a non-particle token's surface (req.allowed_kanji, DESIGN.md §9.1 -- see EnrichRequest.allowed_kanji's own doc comment for why this exists). An empty/absent allowed_kanji still gets the clause (with an empty list) rather than being skipped -- silently omitting the whole rule on the first-ever call (when the known-kanji set might legitimately be small) would defeat the point. */
function allowedKanjiClause(req: EnrichRequest): string {
  return `\n\n例句中出現的漢字只能使用以下允許的漢字：${req.allowed_kanji ?? ""}。需要用到範圍外的詞時，請改用平假名書寫（例：ばんごう）。token 的 reading 只能是假名，不可含漢字。`;
}

/** Appended ONLY when `req.feedback` is non-empty -- a retry after this exact word was rejected once already (DESIGN.md §9.1). Absent on a word's first attempt, deliberately: an empty "here's your feedback: (none)" section would just be noise. */
function feedbackClause(req: EnrichRequest): string {
  const feedback = req.feedback ?? [];
  if (feedback.length === 0) return "";
  return `\n\n你上一次產生的內容被退回，原因如下：\n- ${feedback.join("\n- ")}\n請針對這些問題重新產生，不要重複同樣的錯誤。`;
}

/** The full enrich system prompt for one request: base rules + allowed_kanji clause + (conditionally) feedback clause. Exported so scripts/lib/ai/__tests__/openrouter.test.ts can assert on it directly without going through the full request body. */
export function buildEnrichSystemPrompt(req: EnrichRequest): string {
  return ENRICH_SYSTEM_PROMPT_BASE + allowedKanjiClause(req) + feedbackClause(req);
}

const JUDGE_SYSTEM_PROMPT = `你是日語教材的獨立審查者。你只會看到一個詞與它的例句候選，看不到任何人（或其他 AI）對這個候選的理由或判斷——請完全獨立判讀，不要猜測別人怎麼想。

檢查五件事：
1. natural：這個例句作為 N5 教材是否自然、合乎文法。
2. reading_ok：reading 是否是這個 surface 正確的假名讀音。
3. gloss_ok：中文翻譯（zh／gloss）是否對應日文原意；並逐一檢查例句 example.tokens 中每個 token 的 gloss——是否正確表達該詞「在本句中」的意思（動詞看句中活用、助詞應為括號功能說明如「（主題）」「（受詞）」）、是否為繁體中文（不可是假名讀音、羅馬字、簡體字或空白）。任何一個 token 的 gloss 有誤都要把 gloss_ok 判為 false，並在 issues 指出是哪個 token。
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
    // Both are `undefined` when the caller didn't set them -- JSON.stringify
    // drops an undefined-valued key entirely, so an old-style EnrichRequest
    // (no allowed_kanji/feedback at all) still round-trips to exactly the
    // same JSON shape as before this field existed.
    allowed_kanji: req.allowed_kanji,
    feedback: req.feedback,
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
      { role: "system", content: buildEnrichSystemPrompt(req) },
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
type SleepLike = (ms: number) => Promise<void>;

// ---------------------------------------------------------------------------
// 2026-09-18 P1 fix: a single transient HTTP failure (429/5xx, or the fetch
// call itself throwing -- a DNS hiccup, a dropped connection) used to become
// an immediate AiProviderError, which generate-daily.ts's runGenerationPipeline
// treats as systemic (kind "http"/"network") and aborts the WHOLE run on --
// with the new per-candidate retry design allowing up to 84 calls in one
// run (14 candidates × 3 attempts × up to 2 calls each), the odds of hitting
// a rate limit or a transient 5xx at least once went up, and throwing away
// an entire night's progress over one 429 is exactly the kind of "success
// that isn't" this pipeline exists to avoid repeating (see generate-daily.ts's
// own "卡死" fix header comment for the 2026-09-16/17 precedent).
//
// This retries INSIDE one enrich()/judge() call -- generate-daily.ts's
// attempt/feedback loop never sees it, and it does NOT count against
// MAX_ATTEMPTS_PER_WORD. It's the LAST line of defense before the caller
// has to decide whether to burn one of its own attempts: only once retries
// are exhausted does the caller find out anything went wrong at all.
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504, 529]);
/** How many times to retry AFTER the initial attempt (so up to 4 actual HTTP requests total). */
const MAX_BACKOFF_RETRIES = 3;
/** Wait before retry #1/#2/#3 respectively, when the response carries no (or an unusable) Retry-After header. */
const BACKOFF_DELAYS_MS = [2000, 6000, 18000];
/** Retry-After (seconds, per HTTP spec) is honored when present, but never trusted past this -- a misbehaving/malicious upstream sending "Retry-After: 999999" must not be able to hang this process for that long. */
const MAX_BACKOFF_WAIT_MS = 60000;

const REAL_SLEEP: SleepLike = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** How long to wait before the NEXT attempt, given the attempt index (0-based) that just failed and that failure's Retry-After header value (if any -- only meaningful for an actual HTTP response, never for a network-level throw). */
function computeBackoffWaitMs(failedAttemptIndex: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader !== null) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_BACKOFF_WAIT_MS);
    }
  }
  const fallback = BACKOFF_DELAYS_MS[failedAttemptIndex] ?? BACKOFF_DELAYS_MS[BACKOFF_DELAYS_MS.length - 1];
  return Math.min(fallback, MAX_BACKOFF_WAIT_MS);
}

function resolveModel(cliModel: string | undefined): string {
  // Empty / whitespace counts as unset: GitHub Actions expands an undefined
  // `vars.OPENROUTER_MODEL` to "", and "" ?? default would keep the "".
  const pick = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
  return pick(cliModel) ?? pick(process.env.OPENROUTER_MODEL) ?? DEFAULT_OPENROUTER_MODEL;
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
 *
 * 2026-09-18 P1 fix: retries internally (see RETRYABLE_STATUSES/
 * MAX_BACKOFF_RETRIES above) on 429/5xx/network before throwing at all --
 * `onHttpRequest` fires once per ACTUAL attempt (including retries) so a
 * caller can report a true HTTP-request count (makeOpenRouterEnricher/
 * makeOpenRouterJudge's own `requestCount()`), and `sleep` is injectable so
 * tests never actually wait.
 */
async function callOpenRouter(
  body: ChatRequestBody,
  fetchImpl: FetchLike,
  sleep: SleepLike,
  onHttpRequest?: () => void,
): Promise<{ content: string; finish_reason: string }> {
  const key = requireApiKey();
  const maxAttempts = 1 + MAX_BACKOFF_RETRIES;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    onHttpRequest?.();
    const isLastAttempt = attempt === maxAttempts - 1;

    let response: Response;
    try {
      response = await fetchImpl(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.OPENROUTER_REFERER ?? "https://github.com/chrisliu1121-crypto/nihongo-kiso",
          // Code review item 4 (P1): send both attribution headers -- X-Title
          // is OpenRouter's documented header, X-OpenRouter-Title is added
          // alongside it (not a replacement) per the review's request.
          "X-Title": "nihongo-kiso",
          "X-OpenRouter-Title": "nihongo-kiso",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (!isLastAttempt) {
        await sleep(computeBackoffWaitMs(attempt, null));
        continue;
      }
      throw new AiProviderError("openrouter", "network", `網路請求失敗（已重試 ${MAX_BACKOFF_RETRIES} 次）：${err instanceof Error ? err.message : String(err)}`);
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "(無法讀取回應內容)");
      const snippet = redactSecret(bodyText.slice(0, 300), key);

      if (response.status === 401) {
        // Retrying with the same invalid key can never succeed -- fail loud immediately, no backoff.
        throw new AiProviderError("openrouter", "auth", `OPENROUTER_API_KEY 無效（HTTP 401）：${snippet}`, response.status);
      }

      if (RETRYABLE_STATUSES.has(response.status) && !isLastAttempt) {
        await sleep(computeBackoffWaitMs(attempt, response.headers.get("retry-after")));
        continue;
      }

      if (response.status === 429) {
        throw new AiProviderError("openrouter", "rate_limit", `API 錯誤（status 429，已重試 ${MAX_BACKOFF_RETRIES} 次）：${snippet}`, response.status);
      }
      if (RETRYABLE_STATUSES.has(response.status)) {
        // A retryable 5xx that's STILL failing after every retry -- the
        // service is genuinely down, not just momentarily hiccuping.
        throw new AiProviderError("openrouter", "http", `API 錯誤（status ${response.status}，已重試 ${MAX_BACKOFF_RETRIES} 次）：${snippet}`, response.status);
      }
      // Any other 4xx (400/403/404/422/...): not retryable, fails exactly as before.
      throw new AiProviderError("openrouter", "http", `API 錯誤（status ${response.status}）：${snippet}`, response.status);
    }

    const json: unknown = await response.json();
    const completion = parseCompletion(json);
    checkFinishReason(completion.finish_reason);
    return completion;
  }

  // Unreachable (the loop above always either returns or throws on its last
  // iteration) -- kept only so TypeScript sees every path returning/throwing.
  throw new AiProviderError("openrouter", "network", "重試次數用盡");
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
    const vendor = model.includes("/") ? model.slice(0, model.indexOf("/") + 1) : "anthropic/";
    const sameVendor = ids.filter((id) => id.startsWith(vendor));
    console.error(`模型 "${model}" 不存在。${vendor} 開頭的可用 id 有：${sameVendor.join(", ") || "(無)"}`);
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
  /** 2026-09-18 P1 fix: injectable for tests -- defaults to a real setTimeout-based wait. Used for the backoff-retry delay in callOpenRouter. */
  sleep?: SleepLike;
}

export function makeOpenRouterEnricher(opts: OpenRouterOptions = {}): Enricher {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? REAL_SLEEP;
  let httpRequests = 0;
  return {
    name: "openrouter",
    async enrich(req: EnrichRequest): Promise<EnrichResult> {
      const model = resolveModel(opts.model);
      const body = buildEnrichRequestBody(req, model);
      const completion = await callOpenRouter(body, fetchImpl, sleep, () => {
        httpRequests++;
      });

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
        gloss: t.gloss,
        ...(t.particle === true ? { particle: true as const } : {}),
      }));
      return { example: { ...result.data.example, tokens }, collocations: result.data.collocations, note: result.data.note };
    },
    requestCount: () => httpRequests,
  };
}

export function makeOpenRouterJudge(opts: OpenRouterOptions = {}): Judge {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? REAL_SLEEP;
  let httpRequests = 0;
  return {
    name: "openrouter",
    async judge(req: JudgeRequest): Promise<JudgeResult> {
      const model = resolveModel(opts.model);
      const body = buildJudgeRequestBody(req, model);
      const completion = await callOpenRouter(body, fetchImpl, sleep, () => {
        httpRequests++;
      });

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
    requestCount: () => httpRequests,
  };
}

/** Default-constructed provider objects, matching claude.ts's exported ClaudeEnricher/ClaudeJudge shape (plain objects, `name` field) -- used when no --model override is needed. Callers that need --model (generate-daily.ts/cross-check.ts) use makeOpenRouterEnricher/makeOpenRouterJudge directly instead. */
export const OpenRouterEnricher: Enricher = makeOpenRouterEnricher();
export const OpenRouterJudge: Judge = makeOpenRouterJudge();
