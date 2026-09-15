// Layout — the persistent route shell (build task 2026-09 step 4, DESIGN.md
// §3: "五十音表在所有路由下都存在（layout 層），不隨頁面卸載"). KanaTable
// lives here, in exactly one place in the React tree, specifically so
// switching routes (react-router just swaps <Outlet/>'s child) never
// unmounts/remounts it -- pinned/hover state is a module-level singleton
// (src/store/highlight.ts) so it would survive a remount too, but the DOM
// node itself must not be torn down and rebuilt on every navigation.

import { NavLink, Outlet } from "react-router-dom";
import { KanaTable } from "../components/KanaTable";

// Beige header (#f5efe3): active = white pill + dark text + hairline ring so
// it still reads clearly against the beige (the old amber-100 active pill
// nearly vanished on it); hover = translucent white.
const NAV_LINK_CLASS = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
    isActive
      ? "bg-white text-stone-900 shadow-sm ring-1 ring-[#e6dccb]"
      : "text-stone-600 hover:bg-white/60 hover:text-stone-900"
  }`;

// Sticky header height lives in ONE place: --nav-h (src/styles/index.css
// :root). The header's min-height is --nav-h (border-box, border included)
// and the lg sticky aside's top is --nav-h + 1rem, so the gojuon table can
// never slide under the header.
export function Layout() {
  return (
    <div className="min-h-screen bg-stone-50 text-stone-800">
      <header className="sticky top-0 z-30 min-h-(--nav-h) border-b border-[#e6dccb] bg-[#f5efe3] shadow-[0_1px_3px_rgba(68,64,60,0.06)]">
        <nav className="mx-auto flex min-h-(--nav-h) max-w-5xl items-center gap-2 px-4">
          <span className="mr-2 text-sm font-semibold text-stone-900">日語基礎</span>
          <NavLink to="/" end className={NAV_LINK_CLASS}>
            今日單詞
          </NavLink>
          <NavLink to="/bank" className={NAV_LINK_CLASS}>
            單詞庫
          </NavLink>
          <NavLink to="/grammar" className={NAV_LINK_CLASS}>
            文法
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
        <aside className="lg:sticky lg:top-[calc(var(--nav-h)+1rem)] lg:w-[17rem] lg:shrink-0">
          <KanaTable />
        </aside>

        <main className="flex-1 space-y-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
