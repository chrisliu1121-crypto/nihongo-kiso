// Pure date / day-lookup helpers for the daily word bank, split out of
// index.ts specifically so they're unit-testable without importing
// data/bank.json (gitignored -- see index.ts's own comment on why importing
// it can fail on a fresh clone before `npm run build:bank` has ever run).
// index.ts re-exports everything here; DailyWords.tsx imports shiftDateKey
// from index.ts too (it used to define its own copy).

import type { Bank, DayEntry } from "./types.ts";

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

/** `dateKey` shifted by `deltaDays` calendar days, formatted back to YYYY-MM-DD. */
export function shiftDateKey(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + deltaDays);
  return todayKey(dt);
}
