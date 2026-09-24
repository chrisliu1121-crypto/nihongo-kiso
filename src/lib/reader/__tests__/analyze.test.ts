import { describe, expect, it, vi } from "vitest";
import { analyzeText, deriveTitle, MAX_INPUT_LENGTH, MAX_SEGMENT_LENGTH, segmentText } from "../analyze";

function okCompletion(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null } as unknown as Headers,
    text: async () => JSON.stringify({}),
    json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: "stop" }] }),
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
});
