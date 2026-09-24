// Layout — the persistent route shell (build task 2026-09 step 4, DESIGN.md
// §3: "五十音表在所有路由下都存在（layout 層），不隨頁面卸載"). KanaTable
// lives here, in exactly one place in the React tree, specifically so
// switching routes (react-router just swaps <Outlet/>'s child) never
// unmounts/remounts it -- pinned/hover state is a module-level singleton
// (src/store/highlight.ts) so it would survive a remount too, but the DOM
// node itself must not be torn down and rebuilt on every navigation.

import { NavLink, Outlet, useLocation } from "react-router-dom";
import { KanaDrawer } from "../components/KanaDrawer";
import { KanaTable } from "../components/KanaTable";
import { useMediaQuery } from "../lib/ui/useMediaQuery";
import { setOpen, useKanaPanelOpen } from "../store/kanaPanel";

// Beige header (#f5efe3): active = white pill + dark text + hairline ring so
// it still reads clearly against the beige (the old amber-100 active pill
// nearly vanished on it); hover = translucent white. shrink-0 so the nav's
// new overflow-x-auto (mobile: six links no longer squeeze into a vertical
// stack of wrapped single characters) never shrinks a link's own hit area
// instead of scrolling past it.
const NAV_LINK_CLASS = ({ isActive }: { isActive: boolean }) =>
  `shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
    isActive
      ? "bg-white text-stone-900 shadow-sm ring-1 ring-[#e6dccb]"
      : "text-stone-600 hover:bg-white/60 hover:text-stone-900"
  }`;

// The lg breakpoint matches Tailwind's default `lg:` (min-width: 1024px) --
// same cutoff every `lg:` utility below already uses, so the JS-driven
// choice between <aside><KanaTable/></aside> and <KanaDrawer/> never
// disagrees with the CSS.
const DESKTOP_QUERY = "(min-width: 1024px)";

// The route whose desktop aside swaps the always-on <KanaTable/> for a
// collapsed "打開會記錄為偷看" card (build task 2026-09 "五十音練習" --
// looking the table up while doing the kana quiz should be a deliberate,
// recorded action, not just glancing at the sidebar that's already open on
// every other page). Kept as its own pure function (rather than inlined
// into the component) specifically so a test can assert this route match
// without mounting the whole Layout/Router tree.
export function isKanaQuizRoute(pathname: string): boolean {
  return pathname === "/practice/kana";
}

// Sticky header height lives in ONE place: --nav-h (src/styles/index.css
// :root). The header's min-height is --nav-h (border-box, border included)
// and the lg sticky aside's top is --nav-h + 1rem, so the gojuon table can
// never slide under the header.
export function Layout() {
  // KanaTable keeps a cellId -> HTMLDivElement ref map (for the yoon
  // connector <line>s) that assumes exactly one mounted instance. Simply
  // CSS-hiding an <aside> at narrow widths (e.g. `hidden lg:block`) would
  // still mount a second KanaTable inside KanaDrawer alongside it, so the
  // aside and the drawer are rendered as strict alternatives -- never both
  // -- gated on this single boolean instead. The highlight store itself is
  // a module-level singleton (src/store/highlight.ts), so switching which
  // one is mounted (e.g. rotating a tablet across the breakpoint) never
  // loses hover/pinned/context state.
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const location = useLocation();
  const onKanaQuizRoute = isKanaQuizRoute(location.pathname);
  const kanaPanelOpen = useKanaPanelOpen();

  return (
    <div className="min-h-screen bg-stone-50 text-stone-800">
      <header className="sticky top-0 z-30 min-h-(--nav-h) border-b border-[#e6dccb] bg-[#f5efe3] shadow-[0_1px_3px_rgba(68,64,60,0.06)]">
        <nav className="mx-auto flex min-h-(--nav-h) max-w-5xl items-center gap-2 overflow-x-auto whitespace-nowrap px-4 no-scrollbar">
          <span className="mr-2 shrink-0 text-sm font-semibold text-stone-900">日語基礎</span>
          <NavLink to="/" end className={NAV_LINK_CLASS}>
            今日單詞
          </NavLink>
          <NavLink to="/bank" className={NAV_LINK_CLASS}>
            單詞庫
          </NavLink>
          <NavLink to="/grammar" className={NAV_LINK_CLASS}>
            文法
          </NavLink>
          <NavLink to="/practice/kana" className={NAV_LINK_CLASS}>
            五十音練習
          </NavLink>
          <NavLink to="/practice/arrange" className={NAV_LINK_CLASS}>
            排列練習
          </NavLink>
          <NavLink to="/practice/particle" className={NAV_LINK_CLASS}>
            助詞對照器
          </NavLink>
        </nav>
      </header>

      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8 lg:flex-row lg:items-start">
        {isDesktop && (
          <aside className="lg:sticky lg:top-[calc(var(--nav-h)+1rem)] lg:w-[17rem] lg:shrink-0">
            {onKanaQuizRoute ? (
              <KanaQuizAside open={kanaPanelOpen} />
            ) : (
              // Every other route: the gojuon table stays always-on,
              // regardless of whatever the kanaPanel store happens to hold
              // left over from a visit to /practice/kana (spec: "離開這個
              // 路由 -> 其他頁 aside 照舊常駐顯示（不受 store 影響）").
              <KanaTable />
            )}
          </aside>
        )}

        <main className="flex-1 space-y-6 pb-[calc(3rem+env(safe-area-inset-bottom))] lg:pb-0">
          <Outlet />
        </main>
      </div>

      {!isDesktop && <KanaDrawer />}
    </div>
  );
}

/**
 * Desktop-only aside content for /practice/kana (build task 2026-09
 * "五十音練習"): collapsed by default -- a plain card naming what opening it
 * costs ("打開會記錄為偷看") -- and only mounts <KanaTable/> once the
 * learner explicitly asks for it via the kanaPanel store. Opening it (or
 * the mobile KanaDrawer's equivalent) is what PracticeKana.tsx reads to
 * mark the current question `peeked: true`.
 */
function KanaQuizAside({ open }: { open: boolean }) {
  if (!open) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 bg-white p-4 text-sm text-stone-600">
        <p className="mb-3">五十音表（打開會記錄為偷看）</p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-600 transition-colors duration-150 hover:border-amber-300 hover:bg-amber-50/60"
        >
          打開五十音表
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <KanaTable />
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="w-full rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-600 transition-colors duration-150 hover:border-amber-300 hover:bg-amber-50/60"
      >
        收起五十音表
      </button>
    </div>
  );
}
