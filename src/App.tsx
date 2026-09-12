// App — top-level router (DESIGN.md §3, build task 2026-09 step 4). KanaTable
// now lives in routes/Layout.tsx so it stays mounted across every route
// (DailyWords used to render it inline through step 3 -- see that file's own
// header comment).

import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./routes/Layout";
import { DailyWords } from "./pages/DailyWords";
import { GrammarOverview } from "./pages/GrammarOverview";
import { ParticlePage } from "./pages/ParticlePage";
import { NotFound } from "./pages/NotFound";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DailyWords />} />
          <Route path="grammar" element={<GrammarOverview />} />
          <Route path="grammar/:particleId" element={<ParticlePage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
