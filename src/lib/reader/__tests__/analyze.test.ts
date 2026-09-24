import { describe, expect, it, vi } from "vitest";
import {
  analyzeText,
  continueAnalysis,
  deriveTitle,
  MAX_INPUT_LENGTH,
  MAX_SEGMENT_LENGTH,
  segmentText,
} from "../analyze";
import type { TextDoc } from "../types";

function okCompletion(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null } as unknown as Headers,
    text: async () => JSON.stringify({}),
    json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: "stop" }] }),
  } as unknown as Response;
}

function errorCompletion(status: number, bodyText: string): Response {
  return {
    ok: false,
    status,
    headers: { get: () => null } as unknown as Headers,
    text: async () => bodyText,
    json: async () => JSON.parse(bodyText),
  } as unknown as Response;
}

describe("segmentText", () => {
  it("stays under the requested length when the input is naturally short", () => {
    const segments = segmentText("私は元気です。\n学校に行きます。", MAX_SEGMENT_LENGTH);
    expect(segments.length).toBe(1);
  });

  it("never splits a sentence across two segments, even if that makes one segment exceed maxLen", () => {
    const longSentence = "あ".repeat(900) + "。";
    const segments = segmentText(longSentence, 800);
    expect(segments).toEqual([longSentence]);
  });

  it("groups multiple short sentences into one segment up to maxLen, then starts a new one", () => {
    const unit = "ねこがいます。"; // 7 chars
    const text = Array.from({ length: 20 }, () => unit).join("\n");
    const segments = segmentText(text, 30);
    // Every segment must stay at or under 30 chars (units are short enough to pack).
    for (const seg of segments) expect(seg.length).toBeLessThanOrEqual(30);
    // Concatenating every segment's units (ignoring the "\n" joins this
    // function inserts) must reproduce every original unit, in order.
    const rebuilt = segments.join("\n").split("\n").filter((s) => s !== "");
    expect(rebuilt.length).toBe(20);
  });
});

describe("deriveTitle", () => {
  it("takes the first 20 chars of the first non-blank line", () => {
    expect(deriveTitle("\n\n春はあけぼの、やうやう白くなりゆく山際すこし明かりて")).toBe(
      "春はあけぼの、やうやう白くなりゆく山際すこし明かりて".slice(0, 20),
    );
  });

  it("falls back to a placeholder for blank input", () => {
    expect(deriveTitle("   \n  \n")).toBe("未命名文本");
  });
});

describe("analyzeText", () => {
  it("rejects input over MAX_INPUT_LENGTH before making any request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const tooLong = "あ".repeat(MAX_INPUT_LENGTH + 1);
    await expect(analyzeText(tooLong, { apiKey: "k", model: "m", fetchImpl })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("builds a TextDoc: particle は→wa locally, an unreadable reading is kept but marked invalid, and bad translation indices are dropped", async () => {
    const payload = {
      sentences: [
        {
          tokens: [
            { surface: "私", reading: "わたし", gloss: "我", particle: null },
            { surface: "は", reading: "は", gloss: "（主題）", particle: true },
            { surface: "元気", reading: "げんき", gloss: "健康", particle: null },
            { surface: "です", reading: "です", gloss: "是", particle: null },
          ],
          translation: [
            { text: "我", token_indices: [0] },
            // 99 is out of range (only indices 0-3 exist); 2 is duplicated --
            // both must be handled without throwing.
            { text: "很好", token_indices: [2, 3, 99, 2] },
          ],
        },
        {
          tokens: [
            // reading is kanji, not kana -- kanaToCells must throw on this,
            // and the token should come back marked invalid rather than
            // taking down the whole sentence/document.
            { surface: "学校", reading: "学校", gloss: "學校", particle: null },
            { surface: "に", reading: "に", gloss: "（地點）", particle: true },
            { surface: "行きます", reading: "いきます", gloss: "去", particle: null },
          ],
          translation: [{ text: "去學校", token_indices: [0, 1, 2] }],
        },
      ],
      extracted: { vocab: [], grammar: [], particles: [] },
    };

    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(okCompletion(payload));
    const sleep = vi.fn(async () => {});
    const onProgress = vi.fn();

    const doc = await analyzeText("私は元気です。\n学校に行きます。", {
      apiKey: "sk-or-test",
      model: "test/model",
      fetchImpl,
      sleep,
      onProgress,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(doc.sentences).toHaveLength(2);

    // は as a particle token romanizes to "wa", computed locally (never from the AI).
    expect(doc.sentences[0].tokens[1].romaji).toBe("wa");
    expect(doc.sentences[0].tokens[1].invalid).toBe(false);

    // Out-of-range (99) and duplicate (2) indices are both dropped; valid ones survive.
    expect(doc.sentences[0].translation[1].token_indices).toEqual([2, 3]);

    // The kanji-as-reading token is invalid but the sentence/document survives whole.
    expect(doc.sentences[1].tokens[0].invalid).toBe(true);
    expect(doc.sentences[1].tokens[0].romaji).toBe("");
    expect(doc.sentences[1].tokens[1].invalid).toBe(false);
    expect(doc.sentences[1].tokens[1].romaji).toBe("ni");

    expect(onProgress).toHaveBeenCalledWith(0, 1);
    expect(onProgress).toHaveBeenCalledWith(1, 1);
  });

  it("clamps an out-of-range sentence_index into this doc's actual sentence count instead of leaving it dangling", async () => {
    const payload = {
      sentences: [
        {
          tokens: [{ surface: "犬", reading: "いぬ", gloss: "狗", particle: null }],
          translation: [{ text: "狗", token_indices: [0] }],
        },
      ],
      extracted: {
        vocab: [],
        grammar: [{ pattern: "な形容詞", explanation: "...", sentence_index: 5 }], // only sentence 0 exists
        particles: [],
      },
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(okCompletion(payload));
    const doc = await analyzeText("犬。", { apiKey: "k", model: "m", fetchImpl, sleep: vi.fn(async () => {}) });
    expect(doc.sentences).toHaveLength(1);
    expect(doc.extracted.grammar[0].sentence_index).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// P1 review fix: a multi-segment analysis used to only persist the TextDoc
// once EVERY segment succeeded -- a failure partway through threw away
// every already-paid-for segment that came back before it. analyzeText now
// saves incrementally (onSegmentSaved) and continueAnalysis resumes exactly
// the segments that didn't finish, producing the same result as a one-shot
// run that never failed at all.

describe("partial analysis + continueAnalysis (P1 review fix)", () => {
  // Three lines long enough that no two of them can share one 800-char
  // segment (450 + "\n" + 450 > 800), so segmentText is guaranteed to
  // produce exactly one segment per line -- three separate OpenRouter
  // requests, not packed together.
  const line = (tag: string) => "あ".repeat(440) + tag + "。";
  const sourceText = [line("一"), line("二"), line("三")].join("\n");

  function segmentPayload(tag: string) {
    return {
      sentences: [
        {
          tokens: [{ surface: tag, reading: "てすと", gloss: "測試", particle: null }],
          translation: [{ text: "測試", token_indices: [0] }],
        },
      ],
      extracted: {
        vocab: [{ surface: tag, reading: "てすと", gloss: "測試詞", pos: "名詞", note: "" }],
        // Relative to THIS segment's own (single-sentence) response --
        // always 0 here; the interesting assertion is what it becomes
        // after merging into the whole doc.
        grammar: [{ pattern: `pattern-${tag}`, explanation: "說明", sentence_index: 0 }],
        particles: [],
      },
    };
  }

  it("segments the 3-line source into exactly 3 requests", () => {
    expect(segmentText(sourceText, MAX_SEGMENT_LENGTH)).toHaveLength(3);
  });

  it("segment 2 of 3 failing: saves exactly 1 segment, leaves 2 pending, status partial", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(okCompletion(segmentPayload("一")))
      .mockResolvedValueOnce(errorCompletion(400, "boom"));
    const sleep = vi.fn(async () => {});
    const saved: TextDoc[] = [];

    await expect(
      analyzeText(sourceText, { apiKey: "k", model: "m", fetchImpl, sleep, onSegmentSaved: (d) => void saved.push(d) }),
    ).rejects.toThrow();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(saved).toHaveLength(1);
    const partial = saved[0];
    expect(partial.status).toBe("partial");
    expect(partial.pendingSegments).toHaveLength(2);
    expect(partial.sentences).toHaveLength(1);
    expect(partial.sentences[0].tokens[0].surface).toBe("一");
  });

  it("繼續分析 after that failure: reaches 3 sentences, status complete, same sentence_index as a one-shot run", async () => {
    // Reproduce the same partial doc the previous scenario leaves behind.
    const fetchImplRun1 = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(okCompletion(segmentPayload("一")))
      .mockResolvedValueOnce(errorCompletion(400, "boom"));
    let partial: TextDoc | undefined;
    await expect(
      analyzeText(sourceText, {
        apiKey: "k",
        model: "m",
        fetchImpl: fetchImplRun1,
        sleep: vi.fn(async () => {}),
        onSegmentSaved: (d) => {
          partial = d;
        },
      }),
    ).rejects.toThrow();
    if (!partial) throw new Error("test setup failed: no partial doc was saved");

    const fetchImplContinue = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(okCompletion(segmentPayload("二")))
      .mockResolvedValueOnce(okCompletion(segmentPayload("三")));
    const continueSaved: TextDoc[] = [];
    const resumed = await continueAnalysis(partial, {
      apiKey: "k",
      model: "m",
      fetchImpl: fetchImplContinue,
      sleep: vi.fn(async () => {}),
      onSegmentSaved: (d) => void continueSaved.push(d),
    });

    expect(fetchImplContinue).toHaveBeenCalledTimes(2);
    expect(resumed.status).toBe("complete");
    expect(resumed.pendingSegments).toEqual([]);
    expect(resumed.sentences).toHaveLength(3);
    expect(resumed.sentences.map((s) => s.tokens[0].surface)).toEqual(["一", "二", "三"]);
    // Two intermediate saves (segment 2, then segment 3); the second is already status: complete.
    expect(continueSaved).toHaveLength(2);
    expect(continueSaved[0].status).toBe("partial");
    expect(continueSaved[1].status).toBe("complete");

    // Every segment's own grammar entry rebased to its ABSOLUTE sentence
    // index in the finished doc.
    const resumedIndices = resumed.extracted.grammar
      .slice()
      .sort((a, b) => a.pattern.localeCompare(b.pattern))
      .map((g) => g.sentence_index);

    // One-shot control run: identical source, all 3 segments succeed on
    // the first try -- must land on the exact same sentence_index values.
    const fetchImplOneShot = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(okCompletion(segmentPayload("一")))
      .mockResolvedValueOnce(okCompletion(segmentPayload("二")))
      .mockResolvedValueOnce(okCompletion(segmentPayload("三")));
    const oneShot = await analyzeText(sourceText, {
      apiKey: "k",
      model: "m",
      fetchImpl: fetchImplOneShot,
      sleep: vi.fn(async () => {}),
    });
    const oneShotIndices = oneShot.extracted.grammar
      .slice()
      .sort((a, b) => a.pattern.localeCompare(b.pattern))
      .map((g) => g.sentence_index);

    expect(resumedIndices).toEqual(oneShotIndices);
    expect(resumedIndices).toEqual([0, 1, 2]);
  });

  it("continueAnalysis is a no-op on an already-complete doc (no network call)", async () => {
    const completeDoc: TextDoc = {
      id: "x",
      title: "t",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      source: "x",
      model: "m",
      sentences: [],
      extracted: { vocab: [], grammar: [], particles: [] },
      status: "complete",
      pendingSegments: [],
    };
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await continueAnalysis(completeDoc, { apiKey: "k", model: "m", fetchImpl });
    expect(result).toBe(completeDoc);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
