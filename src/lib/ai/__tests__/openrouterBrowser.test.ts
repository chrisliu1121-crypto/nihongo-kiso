import { describe, expect, it, vi } from "vitest";
import { callOpenRouterChat, OpenRouterBrowserError, type ChatRequestBody } from "../openrouterBrowser";

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return {
    ok: (init?.status ?? 200) < 300,
    status: init?.status ?? 200,
    headers: { get: () => null } as unknown as Headers,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

function errorResponse(status: number, bodyText: string): Response {
  return {
    ok: false,
    status,
    headers: { get: () => null } as unknown as Headers,
    text: async () => bodyText,
    json: async () => JSON.parse(bodyText),
  } as unknown as Response;
}

const SOME_BODY: ChatRequestBody = {
  model: "test/model",
  messages: [{ role: "user", content: "{}" }],
  response_format: { type: "json_schema", json_schema: { name: "x", strict: true, schema: {} } },
  temperature: 0,
  max_tokens: 100,
};

function okCompletion(content: string, finishReason = "stop"): Response {
  return jsonResponse({ choices: [{ message: { content }, finish_reason: finishReason }] });
}

describe("callOpenRouterChat", () => {
  it("retries on 429 twice then succeeds, sleeping between each retry", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(errorResponse(429, "rate limited"))
      .mockResolvedValueOnce(errorResponse(429, "rate limited"))
      .mockResolvedValueOnce(okCompletion(JSON.stringify({ ok: true })));
    const sleep = vi.fn(async () => {});

    const result = await callOpenRouterChat({
      apiKey: "sk-or-test",
      body: SOME_BODY,
      fetchImpl,
      sleep,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(JSON.parse(result.content)).toEqual({ ok: true });
  });

  it("401 throws kind 'auth' and never leaks the key into the error message", async () => {
    const secretKey = "sk-or-supersecret-123";
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(errorResponse(401, `{"error":"bad key ${secretKey}"}`));
    const sleep = vi.fn(async () => {});

    let caught: unknown;
    try {
      await callOpenRouterChat({ apiKey: secretKey, body: SOME_BODY, fetchImpl, sleep });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(OpenRouterBrowserError);
    const err = caught as OpenRouterBrowserError;
    expect(err.kind).toBe("auth");
    expect(err.message).not.toContain(secretKey);
    expect(err.message).toContain("[REDACTED]");
    // Only one attempt -- 401 must never be retried.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("finish_reason 'length' throws a truncated error", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(okCompletion("{}", "length"));
    const sleep = vi.fn(async () => {});

    let caught: unknown;
    try {
      await callOpenRouterChat({ apiKey: "sk-or-test", body: SOME_BODY, fetchImpl, sleep });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(OpenRouterBrowserError);
    expect((caught as OpenRouterBrowserError).kind).toBe("truncated");
  });

  it("402 throws kind 'quota' without retrying", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(errorResponse(402, "insufficient credits"));
    const sleep = vi.fn(async () => {});

    let caught: unknown;
    try {
      await callOpenRouterChat({ apiKey: "sk-or-test", body: SOME_BODY, fetchImpl, sleep });
    } catch (err) {
      caught = err;
    }

    expect((caught as OpenRouterBrowserError).kind).toBe("quota");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
