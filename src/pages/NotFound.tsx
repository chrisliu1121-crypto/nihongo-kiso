// NotFound — the `*` catch-all route, and also what ParticlePage renders
// for an unknown :particleId (build task 2026-09 step 4).

import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div className="rounded-lg border border-dashed border-stone-300 bg-white p-6 text-sm text-stone-500">
      <p>找不到這個頁面。</p>
      <Link
        to="/"
        className="mt-3 inline-block rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 transition-colors duration-150 hover:bg-amber-100"
      >
        回首頁
      </Link>
    </div>
  );
}
