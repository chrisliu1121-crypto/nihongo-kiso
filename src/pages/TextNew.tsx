// TextNew — "/texts/new": paste text, hit 分析, watch per-segment progress,
// land on the new text's own page. analyzeText (src/lib/reader/analyze.ts)
// does all the real work; this page is just the form + progress/error UI
// around it.

import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { analyzeText, MAX_INPUT_LENGTH } from "../lib/reader/analyze";
import { OpenRouterBrowserError } from "../lib/ai/openrouterBrowser";
import { getStoredApiKey, getStoredModel } from "../lib/reader/settings";
import { getReaderStore } from "../lib/reader/store";

type Status =
  | { kind: "idle" }
  | { kind: "analyzing"; done: number; total: number }
  | { kind: "error"; message: string; goToSettings?: boolean };

export function TextNew() {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const navigate = useNavigate();

  const apiKey = getStoredApiKey();
  const model = getStoredModel();
  const overLimit = text.length > MAX_INPUT_LENGTH;
  const canAnalyze = text.trim() !== "" && !overLimit && apiKey.trim() !== "" && status.kind !== "analyzing";

  async function handleAnalyze(): Promise<void> {
    setStatus({ kind: "analyzing", done: 0, total: 1 });
    try {
      const doc = await analyzeText(text, {
        apiKey,
        model,
        onProgress: (done, total) => setStatus({ kind: "analyzing", done, total }),
      });
      await getReaderStore().putText(doc);
      navigate(`/texts/${doc.id}`);
    } catch (err) {
      if (err instanceof OpenRouterBrowserError) {
        if (err.kind === "auth") {
          setStatus({ kind: "error", message: "OpenRouter key 無效或未設定，請到設定頁確認。", goToSettings: true });
          return;
        }
        if (err.kind === "quota") {
          setStatus({ kind: "error", message: "OpenRouter 額度不足，請確認帳戶餘額或改用其他模型。" });
          return;
        }
      }
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-stone-900">新增文本</h1>
      </header>

      {apiKey.trim() === "" && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          還沒有設定 OpenRouter key，請先到{" "}
          <Link to="/settings" className="font-medium underline">
            設定
          </Link>{" "}
          頁輸入。
        </p>
      )}

      <div className="space-y-1">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="貼上一段日文文章或歌詞..."
          rows={12}
          disabled={status.kind === "analyzing"}
          className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-200"
        />
        <div className={`text-xs ${overLimit ? "text-red-600" : "text-stone-400"}`}>
          {text.length} / {MAX_INPUT_LENGTH} 字{overLimit && "（超過上限，請縮短）"}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void handleAnalyze()}
          disabled={!canAnalyze}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          分析
        </button>
        {status.kind === "analyzing" && (
          <span className="text-sm text-stone-500">
            分析中... 第 {Math.min(status.done + 1, status.total)} / {status.total} 段
          </span>
        )}
      </div>

      {status.kind === "error" && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {status.message}
          {status.goToSettings && (
            <>
              {" "}
              <Link to="/settings" className="font-medium underline">
                前往設定
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
