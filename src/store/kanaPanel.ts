// kanaPanel — tracks whether the gojuon table has been opened while doing
// the "/practice/kana" quiz, so PracticeKana.tsx can record `peeked: true`
// on a question the learner looked the table up during (build task 2026-09
// "五十音練習": "允許作弊，但不鼓勵"). Same module-level-singleton +
// useSyncExternalStore shape as src/store/highlight.ts/useHighlight.ts, but
// trivial enough (one boolean, no layers, no per-cell resolution) to keep
// the store and its React binding in this single file rather than splitting
// them the way highlight.ts/useHighlight.ts do.
//
// Two callers ever write to this: KanaDrawer.tsx (mobile bottom drawer --
// expanded === open, replacing what used to be its own local useState) and
// routes/Layout.tsx (desktop collapsed-card "打開五十音表" / "收起" buttons,
// only rendered on the /practice/kana route). Everyone else -- PracticeKana
// itself included -- only ever reads via useKanaPanelOpen().

import { useSyncExternalStore } from "react";

export interface KanaPanelState {
  open: boolean;
}

let state: KanaPanelState = { open: false };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getState(): KanaPanelState {
  return state;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setOpen(open: boolean): void {
  if (state.open === open) return;
  state = { open };
  emit();
}

/** Test-only: reset the singleton between test cases. */
export function reset(): void {
  state = { open: false };
  emit();
}

function getOpenSnapshot(): boolean {
  return state.open;
}

/** Whether the gojuon table is currently open (drawer expanded / desktop card expanded). */
export function useKanaPanelOpen(): boolean {
  return useSyncExternalStore(subscribe, getOpenSnapshot, getOpenSnapshot);
}
