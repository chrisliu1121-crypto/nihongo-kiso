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
import type { Bank } from "./types";

export type {
  Bank,
  BuiltSentenceToken,
  ContrastPair,
  ContrastSet,
  DayEntry,
  DaySeed,
  JlptLevel,
  Particle,
  ParticleClass,
  ParticleId,
  ParticlesFile,
  ParticleSense,
  ParticleWeight,
  PartOfSpeech,
  Sentence,
  SentenceFile,
  SentenceSeed,
  SentenceToken,
  Word,
  WordExample,
  WordExampleSeed,
  WordSeed,
} from "./types";
export { PARTICLE_IDS } from "./types";

// Pure helpers live in dates.ts/grammar.ts (no data/bank.json import there),
// so they can be unit-tested without depending on the built bank -- see
// those files.
export { todayKey, getDay, latestDayBefore, shiftDateKey } from "./dates.ts";
export {
  adjacentParticles,
  contrastSetsForParticle,
  getContrastSet,
  getParticle,
  getSentence,
} from "./grammar.ts";

const typedBank = bank as unknown as Bank;

export default typedBank;
