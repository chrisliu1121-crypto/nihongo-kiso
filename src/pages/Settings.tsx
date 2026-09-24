// Settings — "/settings" (nav 最右，「設定」). OpenRouter key/model live
// only in this device's localStorage (src/lib/reader/settings.ts); this
// page also hosts the reader feature's export/import (texts + myWords,
// src/lib/reader/store.ts) since both are "device-local data" concerns.

import { useRef, useState } from "react";
import {
  clearStoredSettings,
  DEFAULT_MODEL,
  getStoredApiKey,
  getStoredModel,
  setStoredApiKey,
  setStoredModel,
} from "../lib/reader/settings";
import { testConnection } from "../lib/ai/openrouterBrowser";
import { getReaderStore } from "../lib/reader/store";

type TestState = { status: "idle" } | { status: "testing" } | { status: "done"; ok: boolean; message: string };

export function Settings() {
  const [apiKey, setApiKey] = useState(() => getStoredApiKey());
  const [model, setModel] = useState(() => getStoredModel());
  const [showKey, setShowKey] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [testState, setTestState] = useState<TestState>({ status: "idle" });
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleSave(): void {
    setStoredApiKey(apiKey.trim());
    setStoredModel(model.trim() || DEFAULT_MODEL);
    setSavedMessage("已儲存到這台裝置");
    window.setTimeout(() => setSavedMessage(null), 2500);
  }

  function handleClear(): void {
    clearStoredSettings();
    setApiKey("");
    setModel(DEFAULT_MODEL);
    setSavedMessage("已清除這台裝置上的設定");
    window.setTimeout(() => setSavedMessage(null), 2500);
  }

  async function handleTestConnection(): Promise<void> {
    setTestState({ status: "testing" });
    const result = await testConnection(apiKey.trim());
    setTestState({ status: "done", ok: result.ok, message: result.message });
  }

  async function handleExport(): Promise<void> {
    const store = getReaderStore();
    const payload = await store.exportAll();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const date = new Date().toISOString().slice(0, 10);
    a.download = `nihongo-kiso-reader-${date}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function handleImportClick(): void {
    fileInputRef.current?.click();
  }

  async function handleImportFile(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const store = getReaderStore();
      const result = await store.importAll(json);
      setImportMessage(`匯入完成：文本 ${result.textsImported} 篇、單字 ${result.wordsImported} 個`);
    } catch (err) {
      setImportMessage(`匯入失敗：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-stone-900">設定</h1>
      </header>

      <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-stone-800">OpenRouter</h2>
        <p className="text-sm text-stone-500">
          這個 key 只會存在「這台裝置」的瀏覽器裡，只會送到 openrouter.ai；每次分析「閱讀」文本都會用到你的
          OpenRouter 額度。共用電腦請用完記得清除。
        </p>

        <div className="space-y-1">
          <label htmlFor="openrouter-key" className="block text-sm font-medium text-stone-700">
            OpenRouter API Key
          </label>
          <div className="flex gap-2">
            <input
              id="openrouter-key"
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="貼上你的 OpenRouter API key"
              autoComplete="off"
              className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-200"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="shrink-0 rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-600 hover:bg-stone-50"
            >
              {showKey ? "隱藏" : "顯示"}
            </button>
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="openrouter-model" className="block text-sm font-medium text-stone-700">
            模型
          </label>
          <input
            id="openrouter-model"
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={DEFAULT_MODEL}
            className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-200"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleSave}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
          >
            儲存
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="rounded-lg border border-stone-200 px-4 py-2 text-sm text-stone-600 hover:bg-stone-50"
          >
            清除
          </button>
          <button
            type="button"
            onClick={() => void handleTestConnection()}
            disabled={testState.status === "testing"}
            className="rounded-lg border border-stone-200 px-4 py-2 text-sm text-stone-600 hover:bg-stone-50 disabled:opacity-50"
          >
            {testState.status === "testing" ? "測試中..." : "測試連線"}
          </button>
          {savedMessage && <span className="text-sm text-emerald-600">{savedMessage}</span>}
          {testState.status === "done" && (
            <span className={`text-sm ${testState.ok ? "text-emerald-600" : "text-red-600"}`}>
              {testState.message}
            </span>
          )}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-stone-800">備份與搬移</h2>
        <p className="text-sm text-stone-500">
          「閱讀」的文本與你選進單字庫的單字只存在這台裝置。匯出成一個 JSON 檔，之後可以在另一台裝置匯入合併。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleExport()}
            className="rounded-lg border border-stone-200 px-4 py-2 text-sm text-stone-600 hover:bg-stone-50"
          >
            匯出 JSON
          </button>
          <button
            type="button"
            onClick={handleImportClick}
            className="rounded-lg border border-stone-200 px-4 py-2 text-sm text-stone-600 hover:bg-stone-50"
          >
            匯入 JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => void handleImportFile(e)}
          />
          {importMessage && <span className="text-sm text-stone-600">{importMessage}</span>}
        </div>
      </section>
    </div>
  );
}
