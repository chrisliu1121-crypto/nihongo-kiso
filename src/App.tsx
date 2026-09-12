// App — top-level route. The foundations demo (KanaTable + Token hand-test
// harness) lived here through DESIGN.md §12 steps 1-2; it's kept in git
// history. This is now the real first page: DESIGN.md §12 step 3.

import { DailyWords } from "./pages/DailyWords";

export function App() {
  return <DailyWords />;
}
