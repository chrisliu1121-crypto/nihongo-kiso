// App — top-level router (DESIGN.md §3, build task 2026-09 step 4). KanaTable
// now lives in routes/Layout.tsx so it stays mounted across every route
// (DailyWords used to render it inline through step 3 -- see that file's own
// header comment).

import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./routes/Layout";
import { DailyWords } from "./pages/DailyWords";
import { WordBank } from "./pages/WordBank";
import { GrammarOverview } from "./pages/GrammarOverview";
import { GrammarItemPage } from "./pages/GrammarItemPage";
import { VerbsPage } from "./pages/VerbsPage";
import { PracticeArrange } from "./pages/PracticeArrange";
import { PracticeKana } from "./pages/PracticeKana";
import { PracticeParticle } from "./pages/PracticeParticle";
import { Settings } from "./pages/Settings";
import { TextList } from "./pages/TextList";
import { TextNew } from "./pages/TextNew";
import { TextDetail } from "./pages/TextDetail";
import { NotFound } from "./pages/NotFound";

export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DailyWords />} />
          <Route path="bank" element={<WordBank />} />
          <Route path="grammar" element={<GrammarOverview />} />
          <Route path="grammar/verbs" element={<VerbsPage />} />
          <Route path="grammar/:id" element={<GrammarItemPage />} />
          <Route path="texts" element={<TextList />} />
          <Route path="texts/new" element={<TextNew />} />
          <Route path="texts/:id" element={<TextDetail />} />
          <Route path="practice/kana" element={<PracticeKana />} />
          <Route path="practice/arrange" element={<PracticeArrange />} />
          <Route path="practice/particle" element={<PracticeParticle />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
