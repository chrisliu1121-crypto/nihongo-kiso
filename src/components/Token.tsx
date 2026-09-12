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

export interface TokenProps {
  /** What's actually displayed as the main text (may include kanji). */
  surface: string;
  /** Kana reading, used for both display fallback and highlight mapping. */
  reading: string;
  /** Display romaji; computed from `reading` (with particle override) when omitted. */
  romaji?: string;
  /** Chinese gloss, shown as a small line under the romaji. */
  gloss?: string;
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
  role = "word",
  particle: particleProp,
  size = "md",
  interactive = true,
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
  const isPinned = highlightState.pinned?.sourceId === sourceId;

  if (!interactive) {
    return (
      <span
        className={`inline-flex flex-col items-center rounded-lg border border-stone-200 bg-white ${PADDING_SIZE[size]}`}
      >
        <TokenBody surface={surface} displayRomaji={displayRomaji} gloss={gloss} size={size} />
      </span>
    );
  }

  const wholeTokenSet = () => buildHighlightSet(sourceId, reading, { particle });

  const handleEnter = () => setLayer("hover", wholeTokenSet());
  const handleLeave = () => clearLayer("hover");
  const handleActivate = () => togglePinned(wholeTokenSet());

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
      aria-pressed={isPinned}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
      onClick={handleActivate}
      onKeyDown={handleKeyDown}
      className={`inline-flex cursor-pointer flex-col items-center rounded-lg border transition-colors duration-150 ${PADDING_SIZE[size]} ${
        isPinned
          ? "border-amber-400 bg-amber-50"
          : "border-stone-200 bg-white hover:border-amber-300 hover:bg-amber-50/60"
      } focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400`}
    >
      <TokenBody surface={surface} displayRomaji={displayRomaji} gloss={gloss} size={size} />
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
