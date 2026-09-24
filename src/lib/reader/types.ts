// src/lib/reader/types.ts — shapes for the "閱讀" (reader) feature. Separate
// from src/lib/bank/types.ts on purpose: bank/types.ts describes the
// pre-built, hand-curated daily word bank (data/bank.json, built at CI time
// from data/words/*.json); TextDoc/MyWord below describe USER-GENERATED
// content that never leaves the user's own browser (pasted text, analyzed
// client-side via OpenRouter, stored in IndexedDB -- see store.ts).

/** One token inside an analyzed sentence, after local post-processing (analyze.ts): `romaji`/`invalid` are computed on-device from `reading` via readingToRomaji, never returned by the AI. */
export interface ReaderToken {
  surface: string;
  reading: string;
  gloss: string;
  particle: boolean | null;
  /** readingToRomaji(reading, { particle }).romaji; "" for a punctuation token (reading === "") or an invalid one. */
  romaji: string;
  /** True when `reading` couldn't be converted (kanaToCells threw -- e.g. the AI put kanji or romaji into reading instead of kana). An invalid token is still kept (never dropped) so the sentence renders in full; the UI shows it as plain text, outside the gojuon-highlight system, with a small warning. */
  invalid: boolean;
}

/** One Chinese-translation fragment, aligned to zero or more tokens of the same sentence (a token can be referenced by more than one fragment, and a fragment can reference more than one token). `token_indices` has already been through local validation (analyze.ts): out-of-range and duplicate indices are dropped before this shape is ever constructed. */
export interface TranslationChunk {
  text: string;
  token_indices: number[];
}

export interface ReaderSentence {
  tokens: ReaderToken[];
  translation: TranslationChunk[];
}

export interface ExtractedVocab {
  surface: string;
  reading: string;
  gloss: string;
  pos: string;
  note: string;
}

export interface ExtractedGrammar {
  pattern: string;
  explanation: string;
  /** Index into the owning TextDoc's `sentences` array (already rebased across request segments -- see analyze.ts). */
  sentence_index: number;
}

export interface ExtractedParticle {
  surface: string;
  usage: string;
  /** Index into the owning TextDoc's `sentences` array (already rebased across request segments -- see analyze.ts). */
  sentence_index: number;
}

export interface Extracted {
  vocab: ExtractedVocab[];
  grammar: ExtractedGrammar[];
  particles: ExtractedParticle[];
}

/** One analyzed text (pasted article/lyrics), stored whole in IndexedDB (store.ts's `texts` object store). */
export interface TextDoc {
  id: string;
  /** Defaults to the first 20 chars of the first non-blank line of `source`; user-editable afterward. */
  title: string;
  createdAt: string;
  updatedAt: string;
  /** The original pasted text, verbatim -- kept so the doc can (in principle) be re-analyzed later. */
  source: string;
  /** The OpenRouter model id used for this analysis (whatever was set on /settings at the time). */
  model: string;
  sentences: ReaderSentence[];
  extracted: Extracted;
}

/** One word a user chose to add to their personal word bank from a text's "AI 擷取" panel (store.ts's `myWords` object store). Distinct from src/lib/bank/types.ts's `Word` -- this is user-picked, device-local, never in the pre-built daily bank. */
export interface MyWord {
  id: string;
  surface: string;
  reading: string;
  gloss: string;
  pos: string;
  note: string;
  /** Which TextDoc this was picked from, and that doc's title at pick time (kept redundantly so the /bank "我的單字" row can show + link to its source even if the title is later renamed -- the link itself always points at the live id, so a rename still resolves correctly; only the label falls back to this snapshot if the text was deleted). */
  fromTextId: string;
  fromTextTitle: string;
  addedAt: string;
  /** readingToRomaji(reading).romaji, computed locally at pick time; "" if `reading` couldn't be converted. */
  romaji: string;
}
