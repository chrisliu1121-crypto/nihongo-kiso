// Token — the single text unit that can ever trigger gojuon-table
// highlighting (DESIGN.md §5.1). Word cards, arrange-practice blocks, and
// particle choices are all just this component with different props; none
// of them may call setLayer/togglePinned themselves.

import { useId, useMemo } from "react";
import type { KeyboardEvent } from "react";
import { moraeWithRomaji, readingToRomaji } from "../lib/kana";
import { buildHighlightSet, clearLayer, setLayer, togglePinned } from "../store/highlight";
import { useHighlightState } from "../store/useHighlight";

export type TokenRole = "noun" | "verb" | "particle" | "phrase" | "word";
export type TokenSize = "sm" | "md" | "lg";
export type GlossMode = "always" | "hover";

export interface TokenProps {
  /** What's actually displayed as the main text (may include kanji). */
  surface: string;
  /** Kana reading, used for both display fallback and highlight mapping. */
  reading: string;
  /** Display romaji; computed from `reading` (with particle override) when omitted. */
  romaji?: string;
  /** Chinese gloss. How it's shown is controlled by `glossMode`. */
  gloss?: string;
  /**
   * How `gloss` is shown. Default `"always"`: a small line under the romaji
   * that takes layout space (grammar/practice pages, headword cards --
   * unchanged). `"hover"`: takes NO layout space -- an absolutely-positioned
   * bubble under the token that fades/slides in while the token is hovered
   * or keyboard-focused (focus-visible), with the token itself lifting ~2px.
   * On touch devices (`@media (hover: none)`) the bubble shows only while
   * this token is pinned; under `prefers-reduced-motion` there's no lift or
   * slide, only show/hide (src/styles/index.css). Used for example-sentence
   * tokens in WordCard/WordBank. Highlighting is unaffected either way.
   */
  glossMode?: GlossMode;
  role?: TokenRole;
  /**
   * Whether `reading`'s は/へ should be read as わ/え (§7 particle
   * override). Defaults to `role === "particle"`; pass this explicitly to
   * override that default in either direction (e.g. a `role="word"` Token
   * whose reading happens to be a bare particle character).
   *
   * The override scans EVERY plain は/へ mora in `reading`, not just "the
   * particle one" -- so `reading` must be a single particle token (or a
   * compound particle like では), never a whole sentence. Passing a full
   * sentence here would silently turn every は/へ in it into wa/e.
   */
  particle?: boolean;
  size?: TokenSize;
  /** Whether this token participates in highlighting at all. Default true. */
  interactive?: boolean;
  /**
   * Whether clicking this token may pin/unpin it (toggle the "pinned"
   * highlight layer). Default true. Set false for a Token that's only ONE
   * of several interchangeable choices rendered side by side (e.g. a
   * particle-swap candidate) whose own click is already handled by a
   * wrapping element for a DIFFERENT purpose (selecting that candidate) --
   * without this, the Token's own togglePinned would ALSO fire on the same
   * click, leaving a single candidate's highlight pinned on the gojuon
   * table after the learner moves to another question or page (build task
   * 2026-09 step 5 review: "pinned 殘留"). Hover/focus highlighting is
   * unaffected -- only the click-to-pin behavior and its `aria-pressed`
   * attribute (omitted entirely, not just false, when `pinnable` is false)
   * are suppressed.
   */
  pinnable?: boolean;
  /** Render a per-mora breakdown strip below the token. Default false. */
  showMorae?: boolean;
  /**
   * Highlight-set source id. Two Token instances that DON'T pass `id` are
   * never treated as "the same token" for pinning purposes, even when
   * surface/reading/role are identical -- each gets its own instance-scoped
   * id via React's `useId()` (e.g. two unrelated は particles in different
   * example sentences pin/unpin independently). Pass the SAME `id`
   * explicitly when multiple Token instances SHOULD share hover/pinned
   * state (e.g. the same word rendered in a word list AND inside a
   * sentence, meant to highlight together).
   */
  id?: string;
}

const SURFACE_SIZE: Record<TokenSize, string> = {
  sm: "text-base",
  md: "text-xl",
  lg: "text-2xl",
};

const PADDING_SIZE: Record<TokenSize, string> = {
  sm: "px-2 py-1",
  md: "px-3 py-1.5",
  lg: "px-4 py-2",
};

const SUB_SIZE: Record<TokenSize, string> = {
  sm: "text-[10px]",
  md: "text-xs",
  lg: "text-sm",
};

export function Token({
  surface,
  reading,
  romaji,
  gloss,
  glossMode = "always",
  role = "word",
  particle: particleProp,
  size = "md",
  interactive = true,
  pinnable = true,
  showMorae = false,
  id,
}: TokenProps) {
  const particle = particleProp ?? role === "particle";
  // See the `id` prop doc above: an instance-scoped fallback (not a
  // content-derived key like `${role}:${surface}:${reading}`) is
  // deliberate -- two Tokens with identical text but no shared `id` must
  // NOT collide in the pinned/hover store.
  const reactId = useId();
  const sourceId = id ?? reactId;

  const displayRomaji = useMemo(
    () => romaji ?? readingToRomaji(reading, { particle }).romaji,
    [romaji, reading, particle],
  );

  const morae = useMemo(
    () => (showMorae ? moraeWithRomaji(reading, { particle }) : []),
    [showMorae, reading, particle],
  );

  const highlightState = useHighlightState();
  const isPinned = pinnable && highlightState.pinned?.sourceId === sourceId;

  const hoverMode = glossMode === "hover";
  // In hover mode the gloss never goes into the in-flow TokenBody line.
  const inlineGloss = hoverMode ? undefined : gloss;
  const bubble = hoverMode && gloss ? <GlossBubble gloss={gloss} /> : null;

  if (!interactive) {
    return (
      <span
        className={`inline-flex flex-col items-center rounded-lg border border-stone-200 bg-white ${PADDING_SIZE[size]}${
          hoverMode ? " group relative" : ""
        }`}
      >
        <TokenBody surface={surface} displayRomaji={displayRomaji} gloss={inlineGloss} size={size} />
        {bubble}
      </span>
    );
  }

  const wholeTokenSet = () => buildHighlightSet(sourceId, reading, { particle });

  const handleEnter = () => setLayer("hover", wholeTokenSet());
  const handleLeave = () => clearLayer("hover");
  const handleActivate = () => {
    if (!pinnable) return;
    togglePinned(wholeTokenSet());
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      handleActivate();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={pinnable ? isPinned : undefined}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
      onClick={handleActivate}
      onKeyDown={handleKeyDown}
      className={`inline-flex cursor-pointer flex-col items-center rounded-lg border ${
        hoverMode ? HOVER_MODE_CLASS : "transition-colors duration-150"
      } ${PADDING_SIZE[size]} ${
        isPinned
          ? "border-amber-400 bg-amber-50"
          : "border-stone-200 bg-white hover:border-amber-300 hover:bg-amber-50/60"
      } focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400`}
    >
      <TokenBody surface={surface} displayRomaji={displayRomaji} gloss={inlineGloss} size={size} />
      {bubble}
      {showMorae && morae.length > 0 && (
        <div className="mt-1.5 flex flex-wrap justify-center gap-1 border-t border-dashed border-stone-200 pt-1.5">
          {morae.map((mora) => (
            <span
              key={mora.index}
              // No onClick here (deliberately): only hover isolates a
              // single mora. A click on a chip is left to bubble up to the
              // parent div's onClick/handleActivate, so clicking anywhere
              // in the token -- chip included -- pins the WHOLE reading,
              // never just one mora.
              onMouseEnter={(event) => {
                event.stopPropagation();
                setLayer(
                  "hover",
                  buildHighlightSet(sourceId, reading, { particle, moraIndex: mora.index }),
                );
              }}
              onMouseLeave={(event) => {
                event.stopPropagation();
                setLayer("hover", wholeTokenSet());
              }}
              className="flex flex-col items-center rounded px-1 text-stone-500 hover:bg-amber-100 hover:text-stone-800"
            >
              <span className={SUB_SIZE[size]}>{mora.text}</span>
              <span className="text-[9px] text-stone-400">{mora.romaji}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * glossMode="hover" root classes. `group` drives the bubble; `relative` anchors
 * it. The hovered/focused token is raised to z-20 (a pinned one to z-10) --
 * the lift's `translate` makes the token its own stacking context, so without
 * this a LATER sibling token (e.g. the next wrapped row) would paint over its
 * bubble. z-20 stays below the sticky header's z-30 (routes/Layout.tsx).
 * `token-hover` is the hook for the hover:none / reduced-motion overrides in
 * src/styles/index.css.
 */
const HOVER_MODE_CLASS =
  "token-hover group relative shadow-sm transition duration-200 ease-out hover:z-20 hover:-translate-y-0.5 hover:shadow-md focus-visible:z-20 focus-visible:-translate-y-0.5 focus-visible:shadow-md aria-pressed:z-10";

/** The glossMode="hover" bubble: out of flow (never shifts wrapped lines), click-through, hidden until the parent token is hovered / focus-visible. */
function GlossBubble({ gloss }: { gloss: string }) {
  return (
    <span className="token-gloss-bubble pointer-events-none absolute top-full left-1/2 z-20 mt-1 -translate-x-1/2 translate-y-1 rounded-md border border-stone-200 bg-white px-2 py-0.5 text-xs font-medium whitespace-nowrap text-stone-700 opacity-0 shadow-md transition duration-200 ease-out group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
      {gloss}
    </span>
  );
}

interface TokenBodyProps {
  surface: string;
  displayRomaji: string;
  gloss: string | undefined;
  size: TokenSize;
}

function TokenBody({ surface, displayRomaji, gloss, size }: TokenBodyProps) {
  return (
    <>
      <span className={`font-medium text-stone-800 ${SURFACE_SIZE[size]}`}>{surface}</span>
      {displayRomaji && <span className={`text-stone-500 ${SUB_SIZE[size]}`}>{displayRomaji}</span>}
      {gloss && <span className={`text-stone-400 ${SUB_SIZE[size]}`}>{gloss}</span>}
    </>
  );
}
