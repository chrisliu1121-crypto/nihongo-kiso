// registry.tsx — Exercise -> renderer dispatch (build task 2026-09 step 5,
// DESIGN.md §8.5: "共用外殼，type 決定 renderer（registry 模式，之後加題型
// 不動既有程式）"). A future exercise type (Cloze / Listening / Translate)
// joins Exercise's union in src/lib/exercise/types.ts and gets one new entry
// here; ExerciseView's callers (PracticeArrange/PracticeParticle) never
// change.

import type { ComponentType } from "react";
import { ArrangeView } from "./ArrangeView";
import { ParticleSwapView } from "./ParticleSwapView";
import type { Exercise } from "../../lib/exercise";

// TS has no way to express "this object's value type narrows together with
// its key" for a plain literal -- ArrangeView really is ComponentType<{
// exercise: ArrangeExercise }>, not the wider ComponentType<{ exercise:
// Exercise }> this map claims. The cast is the one place that fact is
// asserted; ExerciseView's `exercise.type` switch is what actually keeps it
// true (each component only ever receives the sentence its own key names).
const registry = {
  arrange: ArrangeView,
  "particle-swap": ParticleSwapView,
} as unknown as Record<Exercise["type"], ComponentType<{ exercise: Exercise }>>;

export interface ExerciseViewProps {
  exercise: Exercise;
}

export function ExerciseView({ exercise }: ExerciseViewProps) {
  const Component = registry[exercise.type];
  return <Component exercise={exercise} />;
}
