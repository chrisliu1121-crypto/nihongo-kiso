// scripts/lib/ai/__tests__/openrouter.test.ts — build task: OpenRouter
// Enricher/Judge provider. This machine has no OPENROUTER_API_KEY, so every
// test here either exercises pure functions with no network involved, or
// injects a fake `fetchImpl` (vi.fn()) -- nothing here ever touches the
// real network.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnrichRequest } from "../enricher.ts";
import type { JudgeRequest } from "../judge.ts";
import {
  buildEnrichRequestBody,
  buildJudgeRequestBody,
  DEFAULT_OPENROUTER_MODEL,
  makeOpenRouterEnricher,
  makeOpenRouterJudge,
  parseCompletion,
  preflightOpenRouterModel,
  stripFence,
} from "../openrouter.ts";
import { AiProviderError } from "../errors.ts";

const FAKE_KEY = "sk-or-fake-test-key-12345";

const ENRICH_REQ: EnrichRequest = {
  surface: "話す",
  reading: "はなす",
  gloss: "說話",
  pos: "動詞",
  level: "N5",
  existing_surfaces: ["私", "今日"],
};

const JUDGE_REQ: JudgeRequest = {
  surface: "話す",
  reading: "はなす",
  gloss: "說話",
  example: { ja: "話します。", zh: "說話。", tokens: [{ surface: "話します", reading: "はなします", gloss: "說話" }] },
  existing_examples: ["私です。"],
};

// ---------------------------------------------------------------------------
// Request body shape

describe("buildEnrichRequestBody", () => {
  const body = buildEnrichRequestBody(ENRICH_REQ, "some/model");

  it("includes the model and two messages (system + user)", () => {
    expect(body.model).toBe("some/model");
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].role).toBe("user");
  });

  it("the user message JSON-encodes the request fields", () => {
    const userPayload = JSON.parse(body.messages[1].content);
    expect(userPayload).toEqual({
      surface: "話す",
      reading: "はなす",
      gloss: "說話",
      pos: "動詞",
      level: "N5",
      existing_surfaces: ["私", "今日"],
    });
  });

  it("response_format.json_schema.strict is true", () => {
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.name).toBeTruthy();
  });

  it("the schema's required array covers all properties, and additionalProperties is false, recursively", () => {
    assertStrictSchema(body.response_format.json_schema.schema);
  });

  it("temperature is 0 and max_tokens is 8192", () => {
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(8192);
  });
});

describe("buildJudgeRequestBody", () => {
  const body = buildJudgeRequestBody(JUDGE_REQ, "some/model");

  it("includes the model and two messages (system + user)", () => {
    expect(body.model).toBe("some/model");
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].role).toBe("user");
  });

  it("the user message JSON-encodes the request fields", () => {
    const userPayload = JSON.parse(body.messages[1].content);
    expect(userPayload).toEqual({
      surface: "話す",
      reading: "はなす",
      gloss: "說話",
      example: JUDGE_REQ.example,
      existing_examples: ["私です。"],
    });
  });

  it("response_format.json_schema.strict is true", () => {
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
  });

  it("the schema's required array covers all properties, and additionalProperties is false", () => {
    assertStrictSchema(body.response_format.json_schema.schema);
  });
});

/** Recursively assert every object-typed schema node has `additionalProperties: false` and a `required` array that covers exactly its own `properties` keys -- the hard requirement of OpenAI-style strict mode. */
function assertStrictSchema(schema: unknown): void {
  if (typeof schema !== "object" || schema === null) return;
  const node = schema as Record<string, unknown>;
  if (node.type === "object" && node.properties) {
    const propKeys = Object.keys(node.properties as Record<string, unknown>);
    expect(node.additionalProperties).toBe(false);
    expect(node.required).toEqual(propKeys);
    for (const key of propKeys) {
      assertStrictSchema((node.properties as Record<string, unknown>)[key]);
    }
  }
  if (node.type === "array" && node.items) {
    assertStrictSchema(node.items);
  }
}

// ---------------------------------------------------------------------------
// parseCompletion / stripFence

describe("parseCompletion", () => {
  it("normal response: extracts content and finish_reason", () => {
    const json = { choices: [{ message: { content: '{"a":1}' }, finish_reason: "stop" }] };
    expect(parseCompletion(json)).toEqual({ content: '{"a":1}', finish_reason: "stop" });
  });

  it("fence-wrapped response: content is returned as-is (fences stripped separately by stripFence, not parseCompletion)", () => {
    const json = { choices: [{ message: { content: "```json\n{\"a\":1}\n```" }, finish_reason: "stop" }] };
    expect(parseCompletion(json).content).toBe('```json\n{"a":1}\n```');
  });

  it("finish_reason length: still returned by parseCompletion (the caller checks finish_reason separately, before parsing JSON)", () => {
    const json = { choices: [{ message: { content: "{}" }, finish_reason: "length" }] };
    expect(parseCompletion(json)).toEqual({ content: "{}", finish_reason: "length" });
  });

  it("throws a descriptive error when choices/message/content is missing", () => {
    expect(() => parseCompletion({})).toThrow(/choices\[0\]\.message\.content/);
    expect(() => parseCompletion({ choices: [] })).toThrow(/choices\[0\]\.message\.content/);
    expect(() => parseCompletion({ choices: [{ message: {} }] })).toThrow(/choices\[0\]\.message\.content/);
  });
});

describe("stripFence", () => {
  it("strips a ```json ... ``` fence", () => {
    expect(stripFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("strips a plain ``` ... ``` fence", () => {
    expect(stripFence('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("leaves unfenced content untouched (aside from trimming)", () => {
    expect(stripFence('  {"a":1}  ')).toBe('{"a":1}');
  });
});

// ---------------------------------------------------------------------------
// enrich()/judge() over an injected fetchImpl -- never touches the real
// network.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("OpenRouter enrich/judge via injected fetchImpl", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = FAKE_KEY;
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__EXIT_${code}__`);
    }) as never);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("success case: enrich() returns a validated EnrichResult, and the injected fetch received the Authorization header with the key", async () => {
    const enrichResultJson = {
      example: { ja: "話します。", zh: "說話。", tokens: [{ surface: "話します", reading: "はなします", gloss: "說話", particle: null }] },
      collocations: ["日本語を話す"],
      note: null,
    };
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_KEY}`);
      return jsonResponse({ choices: [{ message: { content: JSON.stringify(enrichResultJson) }, finish_reason: "stop" }] });
    });
    const enricher = makeOpenRouterEnricher({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await enricher.enrich(ENRICH_REQ);
    expect(result.example.ja).toBe("話します。");
    expect(result.collocations).toEqual(["日本語を話す"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("success case: judge() returns a validated JudgeResult", async () => {
    const judgeResultJson = { natural: true, reading_ok: true, gloss_ok: true, issues: [] };
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: JSON.stringify(judgeResultJson) }, finish_reason: "stop" }] }),
    );
    const judge = makeOpenRouterJudge({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await judge.judge(JUDGE_REQ);
    expect(result).toEqual(judgeResultJson);
  });

  // Code review item 1 (P0): these per-call failures used to be
  // process.exit(2). They now throw AiProviderError instead, so a mid-batch
  // failure can be caught and recorded by generate-daily.ts's enrich loop
  // rather than killing the whole process -- see errors.ts / P0 fix.

  it("401 case: throws AiProviderError(kind: 'auth'), and the fake key string never appears anywhere in the thrown error", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: "Invalid API key" } }, 401));
    const enricher = makeOpenRouterEnricher({ fetchImpl: fetchImpl as unknown as typeof fetch });

    let caught: unknown;
    try {
      await enricher.enrich(ENRICH_REQ);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AiProviderError);
    const err = caught as AiProviderError;
    expect(err.provider).toBe("openrouter");
    expect(err.kind).toBe("auth");
    expect(err.status).toBe(401);
    expect(err.detail).toMatch(/無效/);
    expect(err.message.includes(FAKE_KEY)).toBe(false);
    expect(err.detail.includes(FAKE_KEY)).toBe(false);
    // process.exit must NOT have been called -- this is exactly the P0 fix:
    // a per-call failure throws instead of killing the process.
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("non-2xx (non-401) HTTP response: throws AiProviderError(kind: 'http') with status and a body snippet, never the key", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: "server exploded" } }, 500));
    const enricher = makeOpenRouterEnricher({ fetchImpl: fetchImpl as unknown as typeof fetch });

    let caught: unknown;
    try {
      await enricher.enrich(ENRICH_REQ);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AiProviderError);
    const err = caught as AiProviderError;
    expect(err.kind).toBe("http");
    expect(err.status).toBe(500);
    expect(err.detail).toMatch(/500/);
    expect(err.detail.includes(FAKE_KEY)).toBe(false);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("code review item 3 (P1): a 401 body containing a canary API-key-shaped string is redacted before it ever reaches the thrown error's message/detail", async () => {
    const canaryKey = "sk-or-canary-do-not-leak-12345";
    const originalKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = canaryKey;
    try {
      const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
        expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${canaryKey}`);
        return jsonResponse({ error: { message: `rejected key ${canaryKey}` } }, 401);
      });
      const enricher = makeOpenRouterEnricher({ fetchImpl: fetchImpl as unknown as typeof fetch });

      let caught: unknown;
      try {
        await enricher.enrich(ENRICH_REQ);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(AiProviderError);
      const err = caught as AiProviderError;
      expect(err.message.includes(canaryKey)).toBe(false);
      expect(err.detail.includes(canaryKey)).toBe(false);
      expect(err.detail).toMatch(/\[REDACTED\]/);
    } finally {
      if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = originalKey;
    }
  });

  it("a thrown network error (fetch itself rejecting) is caught and rethrown as AiProviderError(kind: 'network')", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ENOTFOUND openrouter.ai");
    });
    const enricher = makeOpenRouterEnricher({ fetchImpl: fetchImpl as unknown as typeof fetch });

    let caught: unknown;
    try {
      await enricher.enrich(ENRICH_REQ);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AiProviderError);
    expect((caught as AiProviderError).kind).toBe("network");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("finish_reason length: throws AiProviderError(kind: 'truncated') before attempting to parse JSON", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "" }, finish_reason: "length" }] }));
    const enricher = makeOpenRouterEnricher({ fetchImpl: fetchImpl as unknown as typeof fetch });

    let caught: unknown;
    try {
      await enricher.enrich(ENRICH_REQ);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AiProviderError);
    expect((caught as AiProviderError).kind).toBe("truncated");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("finish_reason content_filter: throws AiProviderError(kind: 'refusal')", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "" }, finish_reason: "content_filter" }] }));
    const enricher = makeOpenRouterEnricher({ fetchImpl: fetchImpl as unknown as typeof fetch });

    let caught: unknown;
    try {
      await enricher.enrich(ENRICH_REQ);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AiProviderError);
    expect((caught as AiProviderError).kind).toBe("refusal");
  });

  it("code review item 4 (P1): sends both X-Title and X-OpenRouter-Title attribution headers", async () => {
    const enrichResultJson = { example: { ja: "x。", zh: "x", tokens: [{ surface: "x", reading: "x", gloss: "（測試）", particle: null }] }, collocations: [], note: null };
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers["X-Title"]).toBe("nihongo-kiso");
      expect(headers["X-OpenRouter-Title"]).toBe("nihongo-kiso");
      return jsonResponse({ choices: [{ message: { content: JSON.stringify(enrichResultJson) }, finish_reason: "stop" }] });
    });
    const enricher = makeOpenRouterEnricher({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await enricher.enrich(ENRICH_REQ);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("uses DEFAULT_OPENROUTER_MODEL when no --model / OPENROUTER_MODEL is set", async () => {
    delete process.env.OPENROUTER_MODEL;
    const enrichResultJson = { example: { ja: "x。", zh: "x", tokens: [{ surface: "x", reading: "x", gloss: "（測試）", particle: null }] }, collocations: [], note: null };
    let sentBody: { model?: string } = {};
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      sentBody = JSON.parse(init?.body as string);
      return jsonResponse({ choices: [{ message: { content: JSON.stringify(enrichResultJson) }, finish_reason: "stop" }] });
    });
    const enricher = makeOpenRouterEnricher({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await enricher.enrich(ENRICH_REQ);
    expect(sentBody.model).toBe(DEFAULT_OPENROUTER_MODEL);
  });
});

// ---------------------------------------------------------------------------
// Missing OPENROUTER_API_KEY on the non-dry-run path: enrich()/judge() must
// exit(2) (checked at the START of enrich()/judge(), not at module load or
// object-construction time -- see openrouter.ts's requireApiKey doc comment
// for why: this is what lets --dry-run, which never calls enrich()/judge()
// at all, skip needing a key).

describe("missing OPENROUTER_API_KEY", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__EXIT_${code}__`);
    }) as never);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("constructing the provider does NOT throw or exit (no key needed just to build the object -- mirrors --dry-run never calling resolveEnricher/enrich at all)", () => {
    expect(() => makeOpenRouterEnricher()).not.toThrow();
    expect(() => makeOpenRouterJudge()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("enrich() exits 2 with a clear message when OPENROUTER_API_KEY is missing, and never calls fetch", async () => {
    const fetchImpl = vi.fn();
    const enricher = makeOpenRouterEnricher({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(enricher.enrich(ENRICH_REQ)).rejects.toThrow("__EXIT_2__");
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(fetchImpl).not.toHaveBeenCalled();
    const loggedText = errorSpy.mock.calls.flat().map((v: unknown) => String(v)).join("\n");
    expect(loggedText).toMatch(/OPENROUTER_API_KEY/);
  });

  it("judge() exits 2 with a clear message when OPENROUTER_API_KEY is missing, and never calls fetch", async () => {
    const fetchImpl = vi.fn();
    const judge = makeOpenRouterJudge({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(judge.judge(JUDGE_REQ)).rejects.toThrow("__EXIT_2__");
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("preflightOpenRouterModel exits 2 with the missing-key message BEFORE ever calling fetch -- this is the ordering guarantee code review item 2 depends on (a machine with no key AND no network must still exit cleanly instead of hanging on the models call)", async () => {
    const fetchImpl = vi.fn();
    await expect(preflightOpenRouterModel(undefined, fetchImpl as unknown as typeof fetch)).rejects.toThrow("__EXIT_2__");
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(fetchImpl).not.toHaveBeenCalled();
    const loggedText = errorSpy.mock.calls.flat().map((v: unknown) => String(v)).join("\n");
    expect(loggedText).toMatch(/OPENROUTER_API_KEY/);
  });
});

// ---------------------------------------------------------------------------
// Code review item 2 (P0): preflightOpenRouterModel -- confirms the
// resolved model id actually exists on OpenRouter (GET /api/v1/models)
// before any per-word enrich/judge call is made. DEFAULT_OPENROUTER_MODEL
// itself was wrong before this review (an id that doesn't exist on
// OpenRouter) -- this preflight is what catches that class of mistake loud
// at startup instead of on the first word.

describe("preflightOpenRouterModel", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let originalKey: string | undefined;

  const modelsResponse = (ids: string[]) => jsonResponse({ data: ids.map((id) => ({ id })) });

  beforeEach(() => {
    originalKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = FAKE_KEY;
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__EXIT_${code}__`);
    }) as never);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("resolved model IS in the fake list: resolves normally, no exit", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe("https://openrouter.ai/api/v1/models");
      return modelsResponse(["anthropic/claude-fable-5.1", "openai/gpt-4o"]);
    });
    await expect(preflightOpenRouterModel("anthropic/claude-fable-5.1", fetchImpl as unknown as typeof fetch)).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("uses DEFAULT_OPENROUTER_MODEL when no cliModel is given, and that id passes against a fake list that includes it", async () => {
    delete process.env.OPENROUTER_MODEL;
    const fetchImpl = vi.fn(async () => modelsResponse([DEFAULT_OPENROUTER_MODEL]));
    await expect(preflightOpenRouterModel(undefined, fetchImpl as unknown as typeof fetch)).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("resolved model is NOT in the fake list: prints the 模型不存在 message with the anthropic/-prefixed ids, and exits 2", async () => {
    const fetchImpl = vi.fn(async () =>
      modelsResponse(["anthropic/claude-sonnet-4.6", "anthropic/claude-opus-5", "openai/gpt-4o"]),
    );
    await expect(preflightOpenRouterModel("anthropic/does-not-exist", fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      "__EXIT_2__",
    );
    expect(exitSpy).toHaveBeenCalledWith(2);
    const loggedText = errorSpy.mock.calls.flat().map((v: unknown) => String(v)).join("\n");
    expect(loggedText).toMatch(/不存在。anthropic[/] 開頭的可用 id 有/);
    expect(loggedText).toMatch(/anthropic\/claude-sonnet-4\.6/);
    expect(loggedText).toMatch(/anthropic\/claude-opus-5/);
    expect(loggedText.includes("openai/gpt-4o")).toBe(false); // only anthropic/-prefixed ids are listed
  });

  it("models endpoint itself fails (non-2xx): exits 2 rather than crashing", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "boom" }, 500));
    await expect(preflightOpenRouterModel("anthropic/claude-fable-5.1", fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      "__EXIT_2__",
    );
    expect(exitSpy).toHaveBeenCalledWith(2);
  });
});

// ---------------------------------------------------------------------------
// Example-token gloss (DESIGN.md §8.2/§9.2): the AI must return a gloss for
// every token, strict json_schema must require it, and the response
// transform must carry it through.

describe("example token gloss", () => {
  it("request body: token items schema has gloss:string and lists it in required (strict: required === properties keys)", () => {
    const body = buildEnrichRequestBody(ENRICH_REQ, "some/model");
    const schema = body.response_format.json_schema.schema as Record<string, any>;
    const items = schema.properties.example.properties.tokens.items;
    expect(items.properties.gloss).toEqual({ type: "string" });
    expect(items.required).toContain("gloss");
    expect(items.required).toEqual(Object.keys(items.properties));
    expect(items.additionalProperties).toBe(false);
  });

  it("enrich system prompt asks for a per-token gloss (Traditional Chinese, particle function labels, no readings)", () => {
    const system = buildEnrichRequestBody(ENRICH_REQ, "some/model").messages[0].content;
    expect(system).toMatch(/"gloss"/);
    expect(system).toMatch(/繁體中文/);
    expect(system).toMatch(/（主題）/);
    expect(system).toMatch(/不可寫假名讀音或羅馬字/);
  });

  it("judge system prompt widens gloss_ok to every example token's gloss", () => {
    const system = buildJudgeRequestBody(JUDGE_REQ, "some/model").messages[0].content;
    expect(system).toMatch(/gloss_ok：[^\n]*每個 token 的 gloss/);
    expect(system).toMatch(/繁體中文/);
  });

  describe("via injected fetchImpl", () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;
    let originalKey: string | undefined;

    beforeEach(() => {
      originalKey = process.env.OPENROUTER_API_KEY;
      process.env.OPENROUTER_API_KEY = FAKE_KEY;
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = originalKey;
      errorSpy.mockRestore();
    });

    const reply = (payload: unknown) =>
      vi.fn(async () => jsonResponse({ choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: "stop" }] }));

    it("response transform carries each token's gloss through (particle null collapses to absent, gloss does not)", async () => {
      const fetchImpl = reply({
        example: {
          ja: "日本語を話します。",
          zh: "說日語。",
          tokens: [
            { surface: "日本語", reading: "にほんご", gloss: "日語", particle: null },
            { surface: "を", reading: "を", gloss: "（受詞）", particle: true },
            { surface: "話します", reading: "はなします", gloss: "說", particle: null },
          ],
        },
        collocations: [],
        note: null,
      });
      const result = await makeOpenRouterEnricher({ fetchImpl: fetchImpl as unknown as typeof fetch }).enrich(ENRICH_REQ);
      expect(result.example.tokens).toEqual([
        { surface: "日本語", reading: "にほんご", gloss: "日語" },
        { surface: "を", reading: "を", gloss: "（受詞）", particle: true },
        { surface: "話します", reading: "はなします", gloss: "說" },
      ]);
    });

    it("AI response missing a token's gloss: zod rejects -> AiProviderError(kind: 'schema')", async () => {
      const fetchImpl = reply({
        example: { ja: "話します。", zh: "說話。", tokens: [{ surface: "話します", reading: "はなします", particle: null }] },
        collocations: [],
        note: null,
      });
      let caught: unknown;
      try {
        await makeOpenRouterEnricher({ fetchImpl: fetchImpl as unknown as typeof fetch }).enrich(ENRICH_REQ);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(AiProviderError);
      expect((caught as AiProviderError).kind).toBe("schema");
      expect((caught as AiProviderError).detail).toMatch(/gloss/);
    });
  });
});

describe("enrich system prompt: particle reading written as the character", () => {
  it("tells the model は/へ/を readings stay は/へ/を, not わ/え/お", () => {
    const system = buildEnrichRequestBody(ENRICH_REQ, "some/model").messages[0].content;
    expect(system).toContain("助詞 は/へ/を 的 reading 照字形寫 は/へ/を，不要寫成 わ/え/お");
  });
});
