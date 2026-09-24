// src/lib/ai/openrouterBrowser.ts — browser-side OpenRouter client for the
// "閱讀" (reader) feature. This is the browser twin of
// scripts/lib/ai/openrouter.ts (Node), following the same discipline:
// response_format json_schema strict, finish_reason checked before the body
// is trusted, 429/5xx/network retried with backoff (injectable sleep), key
// never echoed into an error message, 401 fails loud immediately.
//
// Must NEVER import a Node-only module (no "node:*", no process.env) --
// this file is bundled into the GitHub Pages static site and runs in the
// user's own browser. The API key is supplied by the caller (read from
// localStorage by src/lib/reader/settings.ts / the /settings page), never
// read from an environment variable here.
//
// Deliberately does NOT send "HTTP-Referer" -- a browser's own fetch already
// attaches a real Referer header for a same-origin/cross-origin request, and
// a hand-set one from page JS can be dropped or overridden by the browser
// anyway. "X-Title" is sent (OpenRouter's attribution header) since that one
// is just informational and not something the browser manages itself.

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key";

export type FetchLike = typeof fetch;
export type SleepLike = (ms: number) => Promise<void>;

export type OpenRouterErrorKind =
  | "auth"
  | "quota"
  | "rate_limit"
  | "http"
  | "network"
  | "schema"
  | "truncated"
  | "refusal";

/** Thrown for any per-call OpenRouter failure. `status` is the HTTP status when one exists. Message text is always redacted (see redactSecret) before the key could ever appear in it. */
export class OpenRouterBrowserError extends Error {
  kind: OpenRouterErrorKind;
  status?: number;

  constructor(kind: OpenRouterErrorKind, message: string, status?: number) {
    super(message);
    this.name = "OpenRouterBrowserError";
    this.kind = kind;
    this.status = status;
  }
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface ChatRequestBody {
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

/** Strip a ```json ... ``` or ``` ... ``` markdown fence wrapping `s`, if present. Defensive-only, same as the Node client -- the system prompt already asks for fence-free JSON. */
export function stripFence(s: string): string {
  const trimmed = s.trim();
  const fenceMatch = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(trimmed);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

/** Pull `{ content, finish_reason }` out of an OpenAI-compatible chat-completions response body. Throws a descriptive (kind "schema") error if the shape is unexpected. */
export function parseCompletion(json: unknown): { content: string; finish_reason: string } {
  const obj = json as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }> };
  const choice = obj?.choices?.[0];
  if (!choice || typeof choice.message?.content !== "string" || typeof choice.finish_reason !== "string") {
    throw new OpenRouterBrowserError("schema", "OpenRouter 回應沒有預期的 choices[0].message.content / finish_reason 欄位，無法解析");
  }
  return { content: choice.message.content, finish_reason: choice.finish_reason };
}

function checkFinishReason(finishReason: string): void {
  if (finishReason === "stop") return;
  if (finishReason === "length") {
    throw new OpenRouterBrowserError("truncated", "輸出被截斷（finish_reason: length），內容可能不完整，請試著縮短這段文字後重試");
  }
  if (finishReason === "content_filter") {
    throw new OpenRouterBrowserError("refusal", "回應被內容過濾器擋下（finish_reason: content_filter）");
  }
  console.error(`[openrouterBrowser] 非預期的 finish_reason：${finishReason}`);
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504, 529]);
const MAX_BACKOFF_RETRIES = 3;
/** Wait before retry #1/#2/#3 respectively, when the response carries no (or an unusable) Retry-After header. Same schedule as scripts/lib/ai/openrouter.ts. */
const BACKOFF_DELAYS_MS = [2000, 6000, 18000];
const MAX_BACKOFF_WAIT_MS = 60000;

const REAL_SLEEP: SleepLike = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

/** Replace every occurrence of `secret` inside `text` with "[REDACTED]" before it's ever surfaced in an error message. Run over every response-body snippet unconditionally, even though the response itself never intentionally echoes the key back. */
function redactSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join("[REDACTED]");
}

export interface CallOpenRouterOptions {
  /** The user's own OpenRouter key, read from localStorage by the caller. Never logged, never put in a URL. */
  apiKey: string;
  body: ChatRequestBody;
  /** Injectable for tests -- defaults to the global fetch. */
  fetchImpl?: FetchLike;
  /** Injectable for tests -- defaults to a real setTimeout-based wait. */
  sleep?: SleepLike;
  /** Sent as X-Title. Defaults to "nihongo-kiso". */
  title?: string;
}

/**
 * POST `body` to OpenRouter's chat-completions endpoint and return the
 * parsed completion. Retries internally on 429/5xx/network failure (see
 * RETRYABLE_STATUSES/MAX_BACKOFF_RETRIES) before throwing.
 */
export async function callOpenRouterChat(opts: CallOpenRouterOptions): Promise<{ content: string; finish_reason: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? REAL_SLEEP;
  const key = opts.apiKey;
  const maxAttempts = 1 + MAX_BACKOFF_RETRIES;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const isLastAttempt = attempt === maxAttempts - 1;

    let response: Response;
    try {
      response = await fetchImpl(OPENROUTER_CHAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "X-Title": opts.title ?? "nihongo-kiso",
        },
        body: JSON.stringify(opts.body),
      });
    } catch (err) {
      if (!isLastAttempt) {
        await sleep(computeBackoffWaitMs(attempt, null));
        continue;
      }
      throw new OpenRouterBrowserError(
        "network",
        `網路請求失敗（已重試 ${MAX_BACKOFF_RETRIES} 次）：${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "(無法讀取回應內容)");
      const snippet = redactSecret(bodyText.slice(0, 300), key);

      if (response.status === 401) {
        // Retrying with the same invalid key can never succeed.
        throw new OpenRouterBrowserError("auth", `OpenRouter key 無效（HTTP 401）：${snippet}`, response.status);
      }

      if (response.status === 402) {
        throw new OpenRouterBrowserError("quota", `OpenRouter 額度不足（HTTP 402）：${snippet}`, response.status);
      }

      if (RETRYABLE_STATUSES.has(response.status) && !isLastAttempt) {
        await sleep(computeBackoffWaitMs(attempt, response.headers.get("retry-after")));
        continue;
      }

      if (response.status === 429) {
        throw new OpenRouterBrowserError("rate_limit", `API 錯誤（status 429，已重試 ${MAX_BACKOFF_RETRIES} 次）：${snippet}`, response.status);
      }
      if (RETRYABLE_STATUSES.has(response.status)) {
        throw new OpenRouterBrowserError("http", `API 錯誤（status ${response.status}，已重試 ${MAX_BACKOFF_RETRIES} 次）：${snippet}`, response.status);
      }
      throw new OpenRouterBrowserError("http", `API 錯誤（status ${response.status}）：${snippet}`, response.status);
    }

    const json: unknown = await response.json();
    const completion = parseCompletion(json);
    checkFinishReason(completion.finish_reason);
    return completion;
  }

  throw new OpenRouterBrowserError("network", "重試次數用盡");
}

export interface TestConnectionResult {
  ok: boolean;
  message: string;
}

/**
 * GET /api/v1/key with the given key's Authorization header -- the
 * "測試連線" button on /settings. Never includes the key in the returned
 * message either way. Response shape (per OpenRouter's docs): on success,
 * `{ data: { label, usage, limit, is_free_tier, ... } }` -- we only need to
 * know it was a 200, not parse the body.
 */
export async function testConnection(apiKey: string, fetchImpl: FetchLike = fetch): Promise<TestConnectionResult> {
  if (!apiKey.trim()) {
    return { ok: false, message: "尚未輸入 key" };
  }
  try {
    const response = await fetchImpl(OPENROUTER_KEY_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (response.ok) {
      return { ok: true, message: "連線成功" };
    }
    if (response.status === 401) {
      return { ok: false, message: "key 無效（HTTP 401）" };
    }
    return { ok: false, message: `連線失敗（HTTP ${response.status}）` };
  } catch (err) {
    return { ok: false, message: `連線失敗：${err instanceof Error ? err.message : String(err)}` };
  }
}
