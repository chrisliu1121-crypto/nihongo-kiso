// PracticeParticle — "/practice/particle": the particle-swap explorer list
// + player (DESIGN.md §3/§8.5, build task 2026-09 step 5). Same pager shell
// as PracticeArrange, different exercise type filtered out of the same bank.

import { useState } from "react";
import { ExerciseView } from "../components/exercises/registry";
import bank from "../lib/bank";
import type { Exercise, ParticleSwapExercise } from "../lib/exercise";

function isParticleSwapExercise(exercise: Exercise): exercise is ParticleSwapExercise {
  return exercise.type === "particle-swap";
}

export function PracticeParticle() {
  const exercises = bank.exercises.filter(isParticleSwapExercise);
  const [index, setIndex] = useState(0);

  if (exercises.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-stone-300 bg-white p-6 text-sm text-stone-500">
        尚未建置助詞對照器資料庫。請先執行{" "}
        <code className="rounded bg-stone-100 px-1 py-0.5">npm run build:bank</code>。
      </p>
    );
  }

  const clampedIndex = Math.min(index, exercises.length - 1);
  const exercise = exercises[clampedIndex];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-stone-900">助詞對照器</h1>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIndex((i) => i - 1)}
            disabled={clampedIndex === 0}
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-600 transition-colors duration-150 hover:border-amber-300 hover:bg-amber-50/60 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-stone-200 disabled:hover:bg-white"
          >
            ← 上一題
          </button>
          <span className="min-w-[5rem] text-center text-sm font-medium text-stone-700">
            第 {clampedIndex + 1} / {exercises.length} 題
          </span>
          <button
            type="button"
            onClick={() => setIndex((i) => i + 1)}
            disabled={clampedIndex === exercises.length - 1}
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-600 transition-colors duration-150 hover:border-amber-300 hover:bg-amber-50/60 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-stone-200 disabled:hover:bg-white"
          >
            下一題 →
          </button>
        </div>
      </header>

      <ExerciseView exercise={exercise} />
    </div>
  );
}
