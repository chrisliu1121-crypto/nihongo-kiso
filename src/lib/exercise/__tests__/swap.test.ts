import { describe, expect, it } from "vitest";
import { applyCandidate, resolveSwap } from "../swap";
import type { ParticleSwapExercise } from "../types";
import type { BuiltSentenceToken, Particle, Sentence } from "../../bank/types";

function tok(surface: string, reading: string, particle?: boolean): BuiltSentenceToken {
  return { surface, reading, gloss: surface, particle, morae: [], romaji: "" };
}

// 友達と話します (friend-と-talk), slot_token_index 1 is the と.
function makeSentence(): Sentence {
  const tokens: BuiltSentenceToken[] = [
    tok("友達", "ともだち"),
    tok("と", "と", true),
    tok("話します", "はなします"),
  ];
  return {
    id: "s_test_swap",
    pattern_id: null,
    level: "N5",
    tokens,
    bunsetsu: [[0, 1], [2]],
    valid_orders: [[0, 1]],
    preferred_order: [0, 1],
    translation: "和朋友交談。",
    verified: true,
    tags: [],
    ja: "友達と話します。",
    romaji: "",
  };
}

function makeParticle(overrides: Partial<Particle> = {}): Particle {
  return {
    id: "ni",
    surface: "に",
    reading: "に",
    romaji: "ni",
    romaji_note: null,
    cell: "ni",
    class: "kaku",
    core: "一個「點」",
    zh_bridge: "在／到／給／於",
    senses: [],
    contrast_with: [],
    weight: "heavy",
    ...overrides,
  };
}

function makeExercise(overrides: Partial<ParticleSwapExercise> = {}): ParticleSwapExercise {
  return {
    id: "px_test",
    type: "particle-swap",
    sentence_id: "s_test_swap",
    slot_token_index: 1,
    verified: true,
    focus: ["to", "ni"],
    candidates: [
      { particle_id: "to", verdict: "natural", translation: "和朋友（互相）交談", note: "と 表相互，雙方都在說" },
      { particle_id: "ni", verdict: "different", translation: "對朋友講（單向告知）", note: "に 表單向，只有我在說" },
      { particle_id: "wo", verdict: "invalid", translation: null, note: "話す 的對話對象不用 を" },
      { particle_id: "de", verdict: "marginal", translation: "（用朋友當手段交談）", note: "語意怪異，實際不說" },
    ],
    ...overrides,
  };
}

describe("resolveSwap", () => {
  const exercise = makeExercise();

  it("找到候選時回傳該候選", () => {
    expect(resolveSwap(exercise, "ni")).toEqual({
      particle_id: "ni",
      verdict: "different",
      translation: "對朋友講（單向告知）",
      note: "に 表單向，只有我在說",
    });
  });

  it("invalid 候選的 translation 為 null，仍可解出", () => {
    expect(resolveSwap(exercise, "wo")?.translation).toBeNull();
  });

  it("找不到候選時回傳 undefined", () => {
    expect(resolveSwap(exercise, "no")).toBeUndefined();
  });
});

describe("applyCandidate", () => {
  const sentence = makeSentence();

  it("把 slot 的 token 換成該助詞的 surface/reading，並標 particle:true、gloss 固定", () => {
    const result = applyCandidate(sentence, 1, makeParticle({ id: "ni", surface: "に", reading: "に" }));
    expect(result).toEqual([
      { surface: "友達", reading: "ともだち", gloss: "友達", particle: undefined },
      { surface: "に", reading: "に", gloss: "（助詞）", particle: true },
      { surface: "話します", reading: "はなします", gloss: "話します", particle: undefined },
    ]);
  });

  it("其餘 token 保持原樣（surface/reading/gloss/particle 不受影響）", () => {
    const result = applyCandidate(sentence, 1, makeParticle());
    expect(result[0]).toEqual({ surface: "友達", reading: "ともだち", gloss: "友達", particle: undefined });
    expect(result[2]).toEqual({ surface: "話します", reading: "はなします", gloss: "話します", particle: undefined });
  });

  it("換到不同 slot（若該句有多個助詞）只影響指定 index", () => {
    // Reuse the same 3-token sentence but target index 0 (a non-particle
    // slot) just to confirm the function doesn't care which token it is --
    // it swaps whichever index is asked for.
    const result = applyCandidate(sentence, 0, makeParticle({ surface: "で", reading: "で" }));
    expect(result[0]).toEqual({ surface: "で", reading: "で", gloss: "（助詞）", particle: true });
    expect(result[1]).toEqual({ surface: "と", reading: "と", gloss: "と", particle: true });
  });
});
