import { describe, expect, it } from "vitest";
import kanaData from "../../../../data/kana.json";
import type { CellId, KanaCell } from "../../kana";
import { shapeConfusablesOf } from "../confusables";
import {
  dailyKanaQuiz,
  hasDistinctOptionCells,
  hasDistinctOptionLabels,
  hasSingleCorrectOption,
  slidingWindowOk,
  stemMapsToSingleOption,
} from "../kana";

const CELLS = kanaData.cells as unknown as KanaCell[];
const BY_ID = new Map(CELLS.map((c) => [c.id, c]));

/** `count` consecutive YYYY-MM-DD keys starting 2026-01-01 (leap-year-safe: just walks Date, never hand-computes days-per-month). */
function consecutiveDateKeys(count: number): string[] {
  const keys: string[] = [];
  const cursor = new Date(2026, 0, 1);
  for (let i = 0; i < count; i++) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, "0");
    const d = String(cursor.getDate()).padStart(2, "0");
    keys.push(`${y}-${m}-${d}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

describe("dailyKanaQuiz determinism", () => {
  it("same dateKey twice -> byte-identical result", () => {
    const a = dailyKanaQuiz("2026-09-24", CELLS);
    const b = dailyKanaQuiz("2026-09-24", CELLS);
    expect(a).toEqual(b);
  });

  it("different dateKey -> a different result", () => {
    const a = dailyKanaQuiz("2026-09-24", CELLS);
    const b = dailyKanaQuiz("2026-09-25", CELLS);
    expect(a).not.toEqual(b);
  });
});

describe("dailyKanaQuiz shape", () => {
  const questions = dailyKanaQuiz("2026-09-24", CELLS);

  it("has exactly 30 questions", () => {
    expect(questions).toHaveLength(30);
  });

  it("15 kana-to-romaji + 15 romaji-to-kana", () => {
    const kanaToRomaji = questions.filter((q) => q.type === "kana-to-romaji");
    const romajiToKana = questions.filter((q) => q.type === "romaji-to-kana");
    expect(kanaToRomaji).toHaveLength(15);
    expect(romajiToKana).toHaveLength(15);
  });
});

describe("dailyKanaQuiz across 365 consecutive dates", () => {
  const dateKeys = consecutiveDateKeys(365);
  const perDay = dateKeys.map((key) => ({ key, questions: dailyKanaQuiz(key, CELLS) }));

  it("sliding-window-10 distinct-cellId rule holds every day", () => {
    for (const { key, questions } of perDay) {
      expect(slidingWindowOk(questions, 10), `violated on ${key}`).toBe(true);
    }
  });

  it("every question has exactly 3 options with exactly one correct", () => {
    for (const { key, questions } of perDay) {
      for (const q of questions) {
        expect(hasDistinctOptionCells(q), `${key} ${q.id}: distinct option cells`).toBe(true);
        expect(hasSingleCorrectOption(q), `${key} ${q.id}: single correct option`).toBe(true);
      }
    }
  });

  it("kana-to-romaji: all 3 option romaji strings are distinct", () => {
    for (const { key, questions } of perDay) {
      for (const q of questions.filter((q) => q.type === "kana-to-romaji")) {
        expect(hasDistinctOptionLabels(q), `${key} ${q.id}`).toBe(true);
      }
    }
  });

  it("romaji-to-kana: the romaji stem matches exactly one option (お/を rule)", () => {
    for (const { key, questions } of perDay) {
      for (const q of questions.filter((q) => q.type === "romaji-to-kana")) {
        expect(stemMapsToSingleOption(q, BY_ID), `${key} ${q.id}`).toBe(true);
      }
    }
  });

  it("を is never the correct answer of a romaji-to-kana question", () => {
    for (const { key, questions } of perDay) {
      for (const q of questions) {
        if (q.type === "romaji-to-kana") {
          expect(q.cellId, `${key} ${q.id}`).not.toBe("wo");
        }
      }
    }
  });

  it("を still appears normally as a kana-to-romaji question", () => {
    const anyWoKanaToRomaji = perDay.some(({ questions }) =>
      questions.some((q) => q.type === "kana-to-romaji" && q.cellId === "wo"),
    );
    expect(anyWoKanaToRomaji).toBe(true);
  });
});

describe("distractor quality: shape-confusable group feeds romaji-to-kana distractors", () => {
  it("さ's romaji-to-kana questions draw at least one distractor from its shape group (ち/き) whenever さ shows up as that type", () => {
    const dateKeys = consecutiveDateKeys(365);
    const saGroup = new Set(shapeConfusablesOf("sa"));
    expect(saGroup.size).toBeGreaterThanOrEqual(2); // "群組足夠大" per the task's own wording

    let sawSaRomajiToKana = false;
    for (const key of dateKeys) {
      const questions = dailyKanaQuiz(key, CELLS);
      for (const q of questions) {
        if (q.type !== "romaji-to-kana" || q.cellId !== "sa") continue;
        sawSaRomajiToKana = true;
        const distractorIds = q.options.filter((o) => !o.correct).map((o) => o.cellId);
        const fromGroup = distractorIds.some((id) => saGroup.has(id));
        expect(fromGroup, `${key} ${q.id}: distractors ${distractorIds.join(",")}`).toBe(true);
      }
    }
    expect(sawSaRomajiToKana).toBe(true);
  });
});

describe("slidingWindowOk", () => {
  it("flags two identical cellIds 3 apart within a window of 10", () => {
    const qs = [
      { cellId: "a" as CellId },
      { cellId: "i" as CellId },
      { cellId: "u" as CellId },
      { cellId: "a" as CellId },
    ];
    expect(slidingWindowOk(qs, 10)).toBe(false);
  });

  it("allows the same cellId once the window has passed", () => {
    const qs: { cellId: CellId }[] = [
      "a", "i", "u", "e", "o", "ka", "ki", "ku", "ke", "ko", "a",
    ].map((id) => ({ cellId: id as CellId }));
    expect(slidingWindowOk(qs, 10)).toBe(true);
  });
});
