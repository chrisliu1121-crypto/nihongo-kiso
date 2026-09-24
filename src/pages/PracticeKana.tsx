// PracticeKana — "/practice/kana": daily 30-question kana quiz (build task
// 2026-09 "五十音練習"). Two question types (kana-to-romaji / romaji-to-kana,
// src/lib/quiz/kana.ts's dailyKanaQuiz), min-distance-10 shuffle, big
// plain-text stem, three large tap targets, keyboard 1/2/3 to answer + Enter
// to advance.
//
// The stem is ALWAYS plain text, never a Token -- both before AND after
// answering. Before answering that's the spec's own rule ("作答前用純文字渲
// 染，不能是 Token" -- a Token would light up the answer on the gojuon table
// on hover, handing it away for free). After answering there's simply
// nothing to route through Token: a kana-to-romaji stem is already the
// correct hiragana (Token-ing it now would be redundant with the separate
// "正解" line below), and a romaji-to-kana stem is romaji text, which isn't
// a `reading` Token accepts in the first place. The ONLY Token in this page
// is the post-answer "正解" reveal, built from the tested CELL's own
// hiragana/romaji -- so hovering it to review the table only ever happens
// after the learner has already committed an answer.
//
// Peeking: routes/Layout.tsx's desktop collapsed card and KanaDrawer.tsx's
// mobile drawer both write to the shared kanaPanel store (src/store/
// kanaPanel.ts) when opened. This page only reads it, and only to decide
// whether the CURRENT question should be flagged `peeked: true` once
// answered -- it never opens/closes the panel itself.
//
// Progress persists to localStorage as `kana-quiz:<dateKey>`, one slot per
// question index (dailyKanaQuiz is deterministic per dateKey, so the same
// day's question array always lines up with a previously-saved index). All
// reads/writes are try/catch-wrapped -- a disabled/full/private-mode store
// just means progress doesn't survive a reload, not a crash.

import { useEffect, useMemo, useState } from "react";
import kanaData from "../../data/kana.json";
import { Token } from "../components/Token";
import { todayKey } from "../lib/bank/dates";
import type { CellId, KanaCell } from "../lib/kana";
import { dailyKanaQuiz } from "../lib/quiz/kana";
import type { KanaQuestion, QuizOption } from "../lib/quiz/kana";
import { useKanaPanelOpen } from "../store/kanaPanel";

const CELLS = (kanaData as unknown as { cells: KanaCell[] }).cells;

interface StoredAnswer {
  choiceCellId: CellId;
  correct: boolean;
  peeked: boolean;
}

type Progress = (StoredAnswer | null)[];

function storageKey(dateKey: string): string {
  return `kana-quiz:${dateKey}`;
}

function blankProgress(length: number): Progress {
  return Array.from({ length }, () => null);
}

function isStoredAnswer(value: unknown): value is StoredAnswer {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.choiceCellId === "string" &&
    typeof v.correct === "boolean" &&
    typeof v.peeked === "boolean"
  );
}

function loadProgress(dateKey: string, length: number): Progress {
  try {
    const raw = window.localStorage.getItem(storageKey(dateKey));
    if (!raw) return blankProgress(length);
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return blankProgress(length);
    const result = blankProgress(length);
    for (let i = 0; i < length && i < parsed.length; i++) {
      if (isStoredAnswer(parsed[i])) result[i] = parsed[i];
    }
    return result;
  } catch {
    return blankProgress(length);
  }
}

function saveProgress(dateKey: string, progress: Progress): void {
  try {
    window.localStorage.setItem(storageKey(dateKey), JSON.stringify(progress));
  } catch {
    // Quota exceeded / storage disabled / private mode -- the quiz still
    // works in-memory for this session, it just won't resume after reload.
  }
}

function firstUnansweredIndex(progress: Progress): number {
  const idx = progress.findIndex((a) => a === null);
  return idx === -1 ? progress.length : idx;
}

export function PracticeKana() {
  const dateKey = todayKey();
  const questions = useMemo<KanaQuestion[]>(() => dailyKanaQuiz(dateKey, CELLS), [dateKey]);
  const byId = useMemo(() => new Map(CELLS.map((c) => [c.id, c] as const)), []);

  const [progress, setProgress] = useState<Progress>(() => loadProgress(dateKey, questions.length));
  const [currentIndex, setCurrentIndex] = useState(() =>
    firstUnansweredIndex(loadProgress(dateKey, questions.length)),
  );

  const kanaPanelOpen = useKanaPanelOpen();
  const [peekedThisQuestion, setPeekedThisQuestion] = useState(kanaPanelOpen);

  // New question -> reset the "did they peek" flag, but seed it from
  // whatever the panel's CURRENT state already is (it may have been left
  // open from the previous question -- still visible, still counts).
  useEffect(() => {
    setPeekedThisQuestion(kanaPanelOpen);
    // Deliberately only re-runs on currentIndex: this effect's job is
    // exactly "a new question started", not "the panel changed" (the next
    // effect below handles that).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);

  // Panel opened while this question is up -> stays flagged even if closed
  // again before the learner answers.
  useEffect(() => {
    if (kanaPanelOpen) setPeekedThisQuestion(true);
  }, [kanaPanelOpen]);

  const finished = currentIndex >= questions.length;
  const currentQuestion = finished ? undefined : questions[currentIndex];
  const currentAnswer = finished ? undefined : (progress[currentIndex] ?? null);

  function commitAnswer(option: QuizOption) {
    if (!currentQuestion || currentAnswer) return;
    const next = progress.slice();
    next[currentIndex] = {
      choiceCellId: option.cellId,
      correct: option.correct,
      peeked: peekedThisQuestion,
    };
    setProgress(next);
    saveProgress(dateKey, next);
  }

  function goNext() {
    if (!currentAnswer) return;
    setCurrentIndex((i) => i + 1);
  }

  function restart() {
    const blank = blankProgress(questions.length);
    setProgress(blank);
    saveProgress(dateKey, blank);
    setCurrentIndex(0);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (finished || !currentQuestion) return;
      if (!currentAnswer) {
        if (event.key === "1" || event.key === "2" || event.key === "3") {
          const option = currentQuestion.options[Number(event.key) - 1];
          if (option) commitAnswer(option);
        }
        return;
      }
      if (event.key === "Enter") goNext();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // commitAnswer/goNext close over progress/currentIndex/peekedThisQuestion,
    // all listed below so the listener always sees fresh state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, currentQuestion, currentAnswer, progress, currentIndex, peekedThisQuestion]);

  const answeredCount = progress.filter((a) => a !== null).length;
  const correctCount = progress.filter((a) => a?.correct).length;
  const peekedCount = progress.filter((a) => a?.peeked).length;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-stone-900">五十音練習</h1>
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-stone-600">
          <span>{dateKey}</span>
          <span className="min-w-[6rem] text-center font-medium text-stone-700">
            第 {Math.min(currentIndex + 1, questions.length)} / {questions.length} 題
          </span>
          <span className="text-stone-500">
            已答 {answeredCount}，答對 {correctCount}
          </span>
        </div>
      </header>

      {finished ? (
        <ResultScreen
          questions={questions}
          progress={progress}
          correctCount={correctCount}
          peekedCount={peekedCount}
          byId={byId}
          onRestart={restart}
        />
      ) : (
        currentQuestion && (
          <QuestionCard
            question={currentQuestion}
            answer={currentAnswer ?? null}
            byId={byId}
            onAnswer={commitAnswer}
            onNext={goNext}
          />
        )
      )}
    </div>
  );
}

interface QuestionCardProps {
  question: KanaQuestion;
  answer: StoredAnswer | null;
  byId: Map<CellId, KanaCell>;
  onAnswer: (option: QuizOption) => void;
  onNext: () => void;
}

function QuestionCard({ question, answer, byId, onAnswer, onNext }: QuestionCardProps) {
  const correctCell = byId.get(question.cellId);
  const showResult = answer !== null;

  return (
    <div className="space-y-5 rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
      <p className="text-center text-xs text-stone-400">
        {question.type === "kana-to-romaji" ? "看假名，選讀音" : "看讀音，選假名"}
      </p>

      {/* Plain text, deliberately never a Token -- see this file's header comment. */}
      <p className="py-4 text-center text-6xl font-bold text-stone-900">{question.prompt}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {question.options.map((option, i) => {
          const isChosen = answer?.choiceCellId === option.cellId;
          let cls =
            "min-h-14 rounded-lg border px-3 py-2 text-xl font-medium transition-colors duration-150 ";
          if (showResult) {
            if (option.correct) {
              cls += "border-emerald-300 bg-emerald-50 text-emerald-800";
            } else if (isChosen) {
              cls += "border-rose-300 bg-rose-50 text-rose-800";
            } else {
              cls += "border-stone-200 bg-white text-stone-400";
            }
          } else {
            cls +=
              "border-stone-200 bg-white text-stone-800 hover:border-amber-300 hover:bg-amber-50/60";
          }
          return (
            <button
              key={option.cellId}
              type="button"
              disabled={showResult}
              onClick={() => onAnswer(option)}
              className={cls}
            >
              <span className="mr-2 text-xs text-stone-400">{i + 1}</span>
              {option.label}
            </button>
          );
        })}
      </div>

      {answer && (
        <div className="flex flex-col items-center gap-3 border-t border-dashed border-stone-200 pt-4">
          <p
            className={`text-sm font-medium ${answer.correct ? "text-emerald-700" : "text-rose-700"}`}
          >
            {answer.correct ? "答對了！" : "答錯了。"}
          </p>
          {correctCell && (
            <div className="flex items-center gap-2 text-sm text-stone-500">
              <span>正解：</span>
              <Token
                surface={correctCell.hiragana}
                reading={correctCell.hiragana}
                romaji={correctCell.romaji}
              />
            </div>
          )}
          <button
            type="button"
            onClick={onNext}
            className="rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition-colors duration-150 hover:border-amber-300 hover:bg-amber-50/60"
          >
            下一題（Enter）
          </button>
        </div>
      )}
    </div>
  );
}

interface ResultScreenProps {
  questions: KanaQuestion[];
  progress: Progress;
  correctCount: number;
  peekedCount: number;
  byId: Map<CellId, KanaCell>;
  onRestart: () => void;
}

function ResultScreen({
  questions,
  progress,
  correctCount,
  peekedCount,
  byId,
  onRestart,
}: ResultScreenProps) {
  const wrongItems = questions
    .map((q, i) => ({ question: q, answer: progress[i] }))
    .filter((item): item is { question: KanaQuestion; answer: StoredAnswer } =>
      Boolean(item.answer && !item.answer.correct),
    );

  return (
    <div className="space-y-4 rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
      <p className="text-lg font-semibold text-stone-900">
        答對 {correctCount} / {questions.length}（其中 {peekedCount} 題有打開五十音表）
      </p>

      {wrongItems.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-stone-600">答錯的題目：</p>
          <ul className="space-y-2">
            {wrongItems.map(({ question }) => {
              const cell = byId.get(question.cellId);
              if (!cell) return null;
              return (
                <li key={question.id} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs text-stone-400">
                    {question.type === "kana-to-romaji" ? "看假名選讀音" : "看讀音選假名"}
                  </span>
                  <Token surface={cell.hiragana} reading={cell.hiragana} romaji={cell.romaji} />
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={onRestart}
        className="rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition-colors duration-150 hover:border-amber-300 hover:bg-amber-50/60"
      >
        再做一次同一組
      </button>
    </div>
  );
}
