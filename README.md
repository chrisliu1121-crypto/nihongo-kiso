# nihongo-kiso

日語基礎學習站。一張常駐的五十音表是全站的地基，每日單詞、文法說明、排列練習、助詞對照器都與它連動高亮。內容（單詞、例句、助詞對照題）不是即時生成、用完即丟，而是固定、有限、可累積的教材：由頻率表決定學什麼，AI 只負責把它講清楚，再經程式驗證與二次 AI 交叉檢查才會上線。完整的設計決策與 schema 定稿見 [DESIGN.md](./DESIGN.md)。

## 本機開發

需要 **Node ≥ 24**：`scripts/` 底下的 `.ts` 直接用 Node 內建的 TypeScript 支援執行，不透過 `ts-node`/`tsx`。

```bash
npm install
npm run dev        # 啟動開發伺服器（會先自動跑 build-bank 產生 data/bank.json）
npm test            # vitest run
npm run typecheck    # build-bank + tsc --noEmit
```

`data/bank.json` 是建置產物，不入版控；`npm run dev` / `npm run build` 都會透過 `predev` / `prebuild` 自動重新產生它，不需要手動執行。

## 內容管線

每日內容由 `scripts/generate-daily.ts` 產生，流程是「頻率表選詞 → AI 加工（Enricher）→ 程式驗證 → 獨立 AI 複查（Judge）→ 全部通過才 `--promote` 上線」（細節見 [DESIGN.md](./DESIGN.md) §9）。

```bash
# 先看會挑到哪些詞，不呼叫任何 AI、不寫檔
node scripts/generate-daily.ts --dry-run

# stub provider：不呼叫外部 API，回傳固定假資料，適合測試流程本身
node scripts/generate-daily.ts --enricher stub --judge stub --promote

# openrouter provider：透過 OpenRouter 呼叫真正的模型（預設模型：google/gemini-3.8-flash，執行前會先向 OpenRouter 確認該模型 id 真的存在）
# PowerShell:
$env:OPENROUTER_API_KEY="<你的 key>"
# bash:
export OPENROUTER_API_KEY=<你的 key>

node scripts/generate-daily.ts --enricher openrouter --judge openrouter --promote

# --model 可覆寫預設模型（否則依序看 OPENROUTER_MODEL 環境變數、內建預設值）
node scripts/generate-daily.ts --enricher openrouter --judge openrouter --model <model-id> --promote
```

沒有全部通過驗證與複查的候選會停在 `data/pending/`，不會自動上線。修過 `data/pending/` 底下的檔案後，用 `scripts/cross-check.ts` 重新驗證（它會重跑程式驗證，再跑一次獨立、看不到前一次理由的 AI 複查）：

```bash
node scripts/cross-check.ts --judge openrouter --promote
```

## 部署到 GitHub Pages

1. 在 GitHub 建立一個新 repo（例如 `nihongo-kiso`）。
2. 在本機把它加為 remote 並 push：
   ```bash
   git branch -M main
   git remote add origin https://github.com/chrisliu1121-crypto/nihongo-kiso.git
   git push -u origin main
   ```
3. 到 repo 的 **Settings → Pages**，把 **Source** 改成 **GitHub Actions**。
4. 之後每次 push 到 `main`，`.github/workflows/deploy.yml` 會自動 build 並部署，網址是：
   ```
   https://chrisliu1121-crypto.github.io/nihongo-kiso/
   ```
   （sub-path 由 `VITE_BASE` 依 repo 名稱自動帶入，不需要手動設定。）

## 每日內容自動化（cron）

1. 到 repo 的 **Settings → Secrets and variables → Actions**，新增一個 secret：`OPENROUTER_API_KEY`。
2. `.github/workflows/daily.yml` 預設每天 UTC 21:00（台灣時間隔天 05:00）自動跑一次，也可以到 **Actions** 分頁手動點 **Run workflow** 觸發一次來驗證（可選填 `date` / `model` / `force` 輸入）。
3. **換模型**：預設用 `google/gemini-3.8-flash`。想讓每天自動跑改用別的模型，不用改程式：到 **Settings → Secrets and variables → Actions → Variables** 分頁新增 repository variable `OPENROUTER_MODEL`，值填 OpenRouter 上的模型 id（例如 `anthropic/claude-opus-5`）。手動 Run workflow 時填的 `model` 輸入會蓋過這個變數；兩者都沒設就用預設值。
4. 若當天產生失敗或有候選沒通過複查，工作流程仍會把 `data/pending/` 底下的檔案 commit 上去，並讓該次執行顯示為失敗（紅色），方便注意到需要人工檢視。失敗時先看 `data/pending/` 底下對應日期的檔案。
5. 手動 Run workflow 時若勾選 `force`，會多帶 `--force` 給 `generate-daily.ts`——`data/pending/` 已有同日期的檔案時（可能還沒人工審完）預設會直接拒絕執行，勾選 `force` 才會覆寫它重新產生，避免不小心蓋掉還沒審完的內容。

## 設計文件

完整的教學設計、schema、驗證規則、建置順序見 [DESIGN.md](./DESIGN.md)。
