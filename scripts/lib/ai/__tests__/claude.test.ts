// scripts/lib/ai/__tests__/claude.test.ts — request/response contract for
// scripts/lib/ai/claude.ts's example-token `gloss` field. `@anthropic-ai/sdk`
// is replaced with a vi.mock fake whose messages.create() just records the
// request params and returns a canned Message -- nothing here touches the
// network or needs ANTHROPIC_API_KEY (the fake constructor never checks it).

import { beforeEach, describe, expect, it, vi } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status?: number;
  }
  class AuthenticationError extends APIError {}
  class FakeAnthropic {
    static APIError = APIError;
    static AuthenticationError = AuthenticationError;
    messages = { create: (params: unknown) => createMock(params) };
  }
  return { default: FakeAnthropic };
});

import { ClaudeEnricher, ClaudeJudge } from "../claude.ts";
import { AiProviderError } from "../errors.ts";
import type { EnrichRequest } from "../enricher.ts";
import type { JudgeRequest } from "../judge.ts";

const ENRICH_REQ: EnrichRequest = {
  surface: "学校",
  reading: "がっこう",
  gloss: "學校",
  pos: "名詞",
  level: "N5",
  existing_surfaces: [],
};

function textMessage(payload: unknown) {
  return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(payload) }] };
}

interface CapturedParams {
  system: string;
  output_config: { format: { type: string; schema: Record<string, any> } };
}

describe("ClaudeEnricher -- example token gloss", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("request: output_config json_schema token items have gloss:string, listed in required, additionalProperties:false; system prompt asks for gloss", async () => {
    createMock.mockResolvedValue(
      textMessage({
        example: {
          ja: "学校に行きます。",
          zh: "去學校。",
          tokens: [
            { surface: "学校", reading: "がっこう", gloss: "學校", particle: null },
            { surface: "に", reading: "に", gloss: "（目的地）", particle: true },
            { surface: "行きます", reading: "いきます", gloss: "去", particle: null },
          ],
        },
        collocations: [],
        note: null,
      }),
    );
    await ClaudeEnricher.enrich(ENRICH_REQ);

    expect(createMock).toHaveBeenCalledTimes(1);
    const params = createMock.mock.calls[0][0] as CapturedParams;
    expect(params.output_config.format.type).toBe("json_schema");
    const items = params.output_config.format.schema.properties.example.properties.tokens.items;
    expect(items.properties.gloss).toEqual({ type: "string" });
    expect(items.required).toContain("gloss");
    expect(items.required).toEqual(Object.keys(items.properties));
    expect(items.additionalProperties).toBe(false);
    expect(params.system).toMatch(/"gloss"/);
    expect(params.system).toMatch(/（主題）/);
  });

  it("response: each token's gloss is carried through to the EnrichResult (not dropped by the particle null->absent transform)", async () => {
    createMock.mockResolvedValue(
      textMessage({
        example: {
          ja: "学校に行きます。",
          zh: "去學校。",
          tokens: [
            { surface: "学校", reading: "がっこう", gloss: "學校", particle: null },
            { surface: "に", reading: "に", gloss: "（目的地）", particle: true },
            { surface: "行きます", reading: "いきます", gloss: "去", particle: null },
          ],
        },
        collocations: [],
        note: null,
      }),
    );
    const result = await ClaudeEnricher.enrich(ENRICH_REQ);
    expect(result.example.tokens).toEqual([
      { surface: "学校", reading: "がっこう", gloss: "學校" },
      { surface: "に", reading: "に", gloss: "（目的地）", particle: true },
      { surface: "行きます", reading: "いきます", gloss: "去" },
    ]);
  });

  it("response missing a token's gloss: zod rejects it -> AiProviderError(kind: 'schema')", async () => {
    createMock.mockResolvedValue(
      textMessage({
        example: { ja: "学校です。", zh: "是學校。", tokens: [{ surface: "学校", reading: "がっこう", particle: null }, { surface: "です", reading: "です", gloss: "是", particle: null }] },
        collocations: [],
        note: null,
      }),
    );
    let caught: unknown;
    try {
      await ClaudeEnricher.enrich(ENRICH_REQ);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AiProviderError);
    expect((caught as AiProviderError).kind).toBe("schema");
    expect((caught as AiProviderError).detail).toMatch(/gloss/);
  });
});

describe("ClaudeJudge -- gloss_ok scope", () => {
  it("system prompt tells the judge to check every example token's gloss (correct in-sentence meaning, Traditional Chinese)", async () => {
    createMock.mockReset();
    createMock.mockResolvedValue(textMessage({ natural: true, reading_ok: true, gloss_ok: true, issues: [] }));
    const req: JudgeRequest = {
      surface: "学校",
      reading: "がっこう",
      gloss: "學校",
      example: { ja: "学校です。", zh: "是學校。", tokens: [{ surface: "学校", reading: "がっこう", gloss: "學校" }, { surface: "です", reading: "です", gloss: "是" }] },
      existing_examples: [],
    };
    await ClaudeJudge.judge(req);
    const params = createMock.mock.calls[0][0] as CapturedParams;
    expect(params.system).toMatch(/gloss_ok：[^\n]*每個 token 的 gloss/);
    expect(params.system).toMatch(/繁體中文/);
  });
});

describe("ClaudeEnricher -- particle reading rule in system prompt", () => {
  it("tells the model は/へ/を readings stay は/へ/を, not わ/え/お", async () => {
    createMock.mockReset();
    createMock.mockResolvedValue(
      textMessage({ example: { ja: "学校です。", zh: "是學校。", tokens: [{ surface: "学校", reading: "がっこう", gloss: "學校", particle: null }, { surface: "です", reading: "です", gloss: "是", particle: null }] }, collocations: [], note: null }),
    );
    await ClaudeEnricher.enrich(ENRICH_REQ);
    const params = createMock.mock.calls[0][0] as CapturedParams;
    expect(params.system).toContain("助詞 は/へ/を 的 reading 照字形寫 は/へ/を，不要寫成 わ/え/お");
  });
});
