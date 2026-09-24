// src/lib/reader/settings.ts — the OpenRouter key/model, stored per-device
// in localStorage (user decision: "AI 在瀏覽器直連 OpenRouter...存在該裝置的
// localStorage；每台裝置各輸一次"). Every accessor is defensive about
// localStorage not existing at all (vitest's `environment: "node"` has no
// `localStorage` global, and this module is imported from page components
// that a renderToString smoke test may render under that same node
// environment) -- `typeof localStorage` never throws even when the
// identifier is undeclared, so no try/catch is needed for that check alone,
// but reads/writes are still wrapped in case a browser exposes the global
// yet throws on access (e.g. some "block all cookies/site data" privacy
// modes throw on localStorage access rather than just returning null).

const KEY_STORAGE_KEY = "nihongo-kiso:openrouter-key";
const MODEL_STORAGE_KEY = "nihongo-kiso:openrouter-model";

export const DEFAULT_MODEL = "google/gemini-3.8-flash";

function hasLocalStorage(): boolean {
  return typeof localStorage !== "undefined";
}

export function getStoredApiKey(): string {
  if (!hasLocalStorage()) return "";
  try {
    return localStorage.getItem(KEY_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setStoredApiKey(key: string): void {
  if (!hasLocalStorage()) return;
  try {
    if (key) localStorage.setItem(KEY_STORAGE_KEY, key);
    else localStorage.removeItem(KEY_STORAGE_KEY);
  } catch {
    // Ignore -- a device where localStorage writes throw (private mode,
    // storage quota, disabled site data) just never persists the key;
    // the settings page's own "儲存" feedback is best-effort either way.
  }
}

export function getStoredModel(): string {
  if (!hasLocalStorage()) return DEFAULT_MODEL;
  try {
    return localStorage.getItem(MODEL_STORAGE_KEY) || DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

export function setStoredModel(model: string): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(MODEL_STORAGE_KEY, model || DEFAULT_MODEL);
  } catch {
    // See setStoredApiKey.
  }
}

/** Clears both the key and the model override (used by /settings's "清除" button -- "共用電腦請用完清除"). */
export function clearStoredSettings(): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.removeItem(KEY_STORAGE_KEY);
    localStorage.removeItem(MODEL_STORAGE_KEY);
  } catch {
    // See setStoredApiKey.
  }
}
