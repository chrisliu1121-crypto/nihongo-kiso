// Loads the pre-built daily word bank. data/bank.json is produced by
// `npm run build:bank` from the hand-authored data/words/*.json seeds
// (DESIGN.md §4 "build-time budget everything": morae/romaji/romaji_ascii
// are computed once at build time, never at runtime) -- see
// scripts/build-bank.ts for how, and package.json's predev/prebuild for
// when it runs automatically.
//
// data/bank.json is gitignored (DESIGN.md §8.2: "不手寫、不入版控"), so on
// a fresh clone -- before `npm run build:bank` has ever run -- this import
// has nothing to resolve. tsc/Vite failing on this file in that situation
// is expected and IS the reminder to run `npm run build:bank`; predev/
// prebuild cover `npm run dev`/`npm run build`, so this should only ever
// bite a manual `tsc --noEmit` on a completely fresh clone.
import bank from "../../../data/bank.json";
import type { Bank, DayEntry } from "./types";

export type {
  Bank,
  DayEntry,
  DaySeed,
  JlptLevel,
  PartOfSpeech,
  Word,
  WordExample,
  WordExampleSeed,
  WordSeed,
} from "./types";

const typedBank = bank as unknown as Bank;

export default typedBank;

/** `date`'s local-timezone YYYY-MM-DD key (defaults to right now). */
export function todayKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The day entry for exactly this date, or undefined if it hasn't been generated (yet). */
export function getDay(b: Bank, date: string): DayEntry | undefined {
  return b.days.find((d) => d.date === date);
}

/** The most recent day at or before `date`, or undefined if the bank is empty or every day is after `date`. */
export function latestDayBefore(b: Bank, date: string): DayEntry | undefined {
  let best: DayEntry | undefined;
  for (const day of b.days) {
    if (day.date <= date && (!best || day.date > best.date)) best = day;
  }
  return best;
}
