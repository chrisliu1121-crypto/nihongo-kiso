// Tests for the pure date/day-lookup helpers in ../dates.ts (re-exported by
// ../index.ts). Imported from "../dates" rather than "../index" on purpose:
// ../index.ts imports data/bank.json at module load time, and that file is
// gitignored (only produced by `npm run build:bank`) -- a test that went
// through ../index would break on a fresh clone before the bank is built.
// See ../index.ts's own header comment and dates.ts's header comment.

import { describe, expect, it } from "vitest";
import { getDay, latestDayBefore, shiftDateKey, todayKey } from "../dates";
import type { Bank, DayEntry, Word } from "../types";

function makeBank(dates: string[]): Bank {
  return {
    generated_at: "2026-01-01T00:00:00.000Z",
    days: dates.map((date): DayEntry => ({ date, words: [] as Word[] })),
    words: [],
    sentences: [],
    particles: { particles: [], contrast_sets: [] },
    grammar: { items: [], contrasts: [] },
    exercises: [],
  };
}

describe("shiftDateKey", () => {
  it("跨月：2026-01-31 +1 -> 2026-02-01", () => {
    expect(shiftDateKey("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("跨年：2026-12-31 +1 -> 2027-01-01", () => {
    expect(shiftDateKey("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("閏年：2028-02-28 +1 -> 2028-02-29", () => {
    expect(shiftDateKey("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("非閏年：2027-02-28 +1 -> 2027-03-01", () => {
    expect(shiftDateKey("2027-02-28", 1)).toBe("2027-03-01");
  });

  it("負向：2026-03-01 -1 -> 2026-02-28", () => {
    expect(shiftDateKey("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("負向跨年：2027-01-01 -1 -> 2026-12-31", () => {
    expect(shiftDateKey("2027-01-01", -1)).toBe("2026-12-31");
  });
});

describe("todayKey", () => {
  it("依傳入的 Date 格式化為 YYYY-MM-DD（月/日補零）", () => {
    expect(todayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(todayKey(new Date(2026, 10, 20))).toBe("2026-11-20");
  });
});

describe("getDay", () => {
  const bank = makeBank(["2026-09-10", "2026-09-11", "2026-09-12"]);

  it("命中：回傳對應 DayEntry", () => {
    expect(getDay(bank, "2026-09-11")?.date).toBe("2026-09-11");
  });

  it("未命中：回傳 undefined", () => {
    expect(getDay(bank, "2099-01-01")).toBeUndefined();
  });
});

describe("latestDayBefore", () => {
  it("空 bank：回傳 undefined", () => {
    expect(latestDayBefore(makeBank([]), "2026-09-11")).toBeUndefined();
  });

  it("全部日期都在目標日之後：回傳 undefined", () => {
    const bank = makeBank(["2026-09-12", "2026-09-13"]);
    expect(latestDayBefore(bank, "2026-09-01")).toBeUndefined();
  });

  it("正常情況：取小於等於目標日中最近的一天", () => {
    const bank = makeBank(["2026-09-10", "2026-09-11", "2026-09-12"]);
    expect(latestDayBefore(bank, "2026-09-11")?.date).toBe("2026-09-11");
    expect(latestDayBefore(bank, "2026-09-13")?.date).toBe("2026-09-12");
    expect(latestDayBefore(bank, "2026-09-10T12:00")?.date).toBe("2026-09-10");
  });
});
