# nihongo-kiso — 設計文件

> 日語基礎學習站。核心是一張常駐的五十音表，所有文字內容都與它連動。
>
> 本文件是實作前的定稿：schema、轉換規則、句型清單。程式碼尚未開始。
> 最後更新：2026-09-25（§14 擴充：五十音練習、閱讀器、文法擴充）

---

## 0. 決策紀錄

| 日期 | 決定 | 理由 |
|---|---|---|
| 2026-09-12 | 獨立新 repo，不長在 `~/fluency-forge` 上 | 資料模型方向性衝突：fluency-forge 假設內容由 Claude 即時生成、用完即丟；本站核心是固定、有限、需按表學完的教材。詳見 §11 |
| 2026-09-12 | Vite + React + TS + Tailwind，純靜態部署 | 無後端需求；資料是 repo 裡的 JSON |
| 2026-09-12 | 五十音表固定 46 格，濁音/拗音/促音用徽章表達，不展開額外格子 | 表格形狀本身是記憶線索；擴充靠標記而非增格 |
| 2026-09-12 | 每日單詞由頻率表選詞，AI 只做加工 | LLM 對「常見」的判斷會漂移、會重複 |
| 2026-09-12 | 羅馬字由程式從假名推導，助詞例外走 override | 一致性；但 は→wa / へ→e 無法從字形推導 |
| 2026-09-12 | 助詞練習做「對照探索器」而非選擇題 | 助詞的真相是「好幾個都對，但講的是不同的事」 |
| 2026-09-12 | AI 產題經程式驗證 + 二次 AI 交叉，一致才上線 | 助詞語感沒有可機檢的真值，錯誤率遠高於單詞 |
| 2026-09-12 | 第一版不做音檔，schema 留欄位 | 降低第一版範圍 |
| 2026-09-24 | 閱讀器由瀏覽器直連 OpenRouter，key 存各裝置 localStorage | 純靜態站沒有後端可藏 key；使用者自己的 key、自己的裝置 |
| 2026-09-24 | 閱讀器資料只存本機 IndexedDB，提供匯出/匯入 JSON | 不做帳號與雲端；匯出是唯一的備份手段 |
| 2026-09-24 | 五十音練習排除「を 當 romaji→假名 的正解」 | お 和 を 的羅馬字都是 o，題幹無法唯一對應 |
| 2026-09-24 | 文法資料由「八大助詞」泛化為 GrammarItem，多檔載入 | 要容納格助詞以外的副助詞、接續助詞、終助詞、接續詞、句型；舊 particles 檢視保留相容 |

---

## 1. 產品範圍

### 第一版要有的

1. **五十音表**（46 平假名）常駐於畫面，任何文字單位被指到時對應格子高亮
2. **每日 10 個單詞**：漢字表記 + 假名 + 羅馬字 + 中文；滑過/點選時表格高亮
3. **語序說明頁**：日語語序的骨架圖，針對中文母語者
4. **八大助詞說明頁**：は・が・を・に・で・と・の・も
5. **排列練習**：點選放置字詞成句，每塊底下有中文與羅馬字，三值判定
6. **助詞對照器**：同一句換不同助詞，即時看意思怎麼變

### 明確不做（但留位置）

發音音檔、筆順動畫、片假名表、SRS 複習排程、帳號與雲端同步、測驗計分、句子聽力。
以上全部在 schema 裡留欄位或留 interface，第一版不實作。

---

## 2. 教學設計

### 2.1 五十音表

- 版面：橫式，10 行 × 5 段（あいうえお 為欄）。や行、わ行的空缺保留為空白格，不壓縮——表格的形狀本身是記憶線索。
- 桌面版常駐於側欄；行動版為底部抽屜，收合時剩一條「已點亮 n/46」的細條。
- `を` 是 46 音中初學者在單詞裡看不到的唯一一個。它只在助詞頁才有意義，這給表格一個敘事終點：學完助詞頁，最後一個空白格被填上。

### 2.2 語序

不以「日語是 SOV」開場。核心命題是：

> 中文靠位置決定角色，日語靠助詞決定角色。日語唯一硬性的位置規則是「動詞在最後」。

骨架圖：

```
[ 主題は ]  [ 時間 ]  [ 地點で ]  [ 對象と/に ]  [ 受詞を ]  [ 動詞 ]
   可省略     ←————— 這段順序可互換，語感有別 —————→      ← 不可動
```

給中文母語者的三個好消息（要明講，降低恐懼）：修飾語在被修飾語之前（同中文）、主題—評論結構中文也有（「這本書啊，我看過了」≈ この本は読んだ）、沒有數、性、冠詞的變化。壞消息只有助詞一項。

**這條原則直接決定排列練習不能比對唯一正解**（見 §7.2）。

### 2.3 八大助詞的分類

八個助詞不同類，而這個分類本身就是教學內容：

| 類別 | 助詞 | 作用 |
|---|---|---|
| 格助詞 | が・を・に・で・と | 標記名詞在句中扮演的**角色** |
| 係助詞 | は・も | 標記**這句話在談什麼**（與角色是兩回事） |
| 連體助詞 | の | 連接名詞與名詞 |

は 和 が 難，不是因為相似，而是因為**根本不同層**：が 說「誰做的」，は 說「這句在談誰」。中文使用者有現成直覺（「這本書我看過了」的「這本書」就是 は），只是沒人指出來。

頁面依三類分區，は/が 的對比放在「兩層之間」，而非兩個並列選項。重量嚴重傾斜：は/が 一組的篇幅約等於其餘六個之和。

### 2.4 值得做對照的助詞組

第一版的對照組只做這六組，其餘助詞用單張說明卡即可：

| 組 | 最小對比句 | 差異 |
|---|---|---|
| は / が | 私**は**学生です ／ 私**が**学生です | 主題 vs 焦點（新資訊、疑問詞的答案） |
| は / が（大小主語） | 私**は**日本語**が**好きです | 兩者同句共存，最能說明不同層 |
| に / で | 公園**に**います ／ 公園**で**遊びます | 存在的所在 vs 動作發生的場域 |
| に / で（居住/工作） | 東京**に**住む ／ 東京**で**働く | 靜態附著 vs 活動範圍 |
| と / に | 友達**と**話す ／ 友達**に**話す | 相互 vs 單向 |
| を / が（願望） | 水**を**飲みたい ／ 水**が**飲みたい | 動作對象 vs 慾望對象，語感差異 |

---

## 3. 資訊架構

```
/                      五十音表 + 今日 10 詞
/kana/:cellId          單一假名詳頁（含此假名的已學單詞；筆順、音檔為預留區）
/bank                  全詞庫（可搜尋，羅馬字 ASCII 比對）
/grammar               語序骨架 + 八助詞總覽
/grammar/:particleId   單一助詞說明
/practice/arrange      排列練習
/practice/particle     助詞對照器
/practice/kana         五十音練習（每日 30 題，§14.1）
/grammar/verbs         動詞三大類與活用表（§14.3）
/grammar/:id           單一文法項目（助詞、接續、句型；取代 /grammar/:particleId）
/texts                 閱讀器：文本清單（§14.2）
/texts/new             貼上文本並送 AI 分析
/texts/:id             單篇文本：逐詞、翻譯對齊、擷取詞彙
/settings              OpenRouter key、模型、匯出/匯入
```

五十音表在所有路由下都存在（layout 層），不隨頁面卸載。

---

## 4. 技術棧與目錄

```
nihongo-kiso/
├── DESIGN.md
├── data/
│   ├── kana.json                 # 46 格正典（含衍生關係、預留欄位）
│   ├── particles.json            # 八大助詞說明與對照組
│   ├── patterns.json             # 句型模板（§10）
│   ├── frequency/n5.json         # 選詞用的頻率排序清單
│   ├── words/2026-09-13.json     # 每日 10 詞，一天一檔
│   ├── sentences/*.json          # 例句與練習題
│   └── pending/                  # AI 產出但未通過驗證，待人工
├── src/
│   ├── lib/
│   │   ├── kana/                 # kanaToCells + romaji（純函式，無 UI 依賴）
│   │   │   ├── cells.ts
│   │   │   ├── romaji.ts
│   │   │   └── __tests__/
│   │   ├── exercise/             # 判定器（arrange / particle-swap）
│   │   └── progress/             # ProgressStore interface + localStorage 實作
│   ├── components/
│   │   ├── Token.tsx             # 全站唯一文字單位（§5.1）
│   │   ├── KanaTable.tsx
│   │   └── exercises/
│   ├── store/highlight.ts        # 三層高亮 store（§5.2）
│   └── routes/
├── scripts/
│   ├── build-bank.ts             # words/*.json → bank.json；現階段全部驗證邏輯在這裡，validate.ts 要到第 6 步才拆出
│   ├── generate-daily.ts         # 選詞 + 呼叫 Claude 加工
│   ├── generate-exercises.ts
│   ├── validate.ts               # 程式可驗的全部檢查（§9.2）
│   └── cross-check.ts            # 二次 AI 交叉驗證
└── .github/workflows/daily.yml
```

**建置時預算所有可預算的東西**：`morae` 對映、羅馬字、`romaji_ascii` 全部寫進 JSON，runtime 不做轉換。但轉換函式本身要留著並測試，因為之後「使用者自輸入單詞」「句子逐字亮」會復用同一支。

測試：`src/lib/kana/` 必須有完整測試（fluency-forge 全 repo 零測試，這裡不重蹈）。UI 層不強制。**vitest 環境是 `node`，未裝 jsdom／testing-library**——現有測試全是純函式；若要補元件測試，先裝 `jsdom` + `@testing-library/react` 並在 `vite.config.ts` 分檔指定環境，否則會得到 `document is not defined`。

型別檢查：`data/bank.json` 不入版控，fresh clone 直接跑 `tsc --noEmit` 會因缺檔失敗。用 `npm run typecheck`（先 build:bank 再 tsc）；`dev`／`build` 已透過 `predev`／`prebuild` 自動處理。

---

## 5. 核心機制

### 5.1 `Token` — 全站唯一文字單位

單詞卡、排列練習的積木、助詞選項，三者的需求完全相同：顯示文字、底下有羅馬字與中文小字、被指到時高亮五十音表。**不做三次，做一個。**

```tsx
<Token
  surface="東京へ"        // 顯示的表記
  reading="とうきょうへ"   // 假名讀音，對映用
  romaji="tōkyō e"        // 顯示用（可被 override）
  gloss="到東京"          // 中文小字，可選
  role="phrase"           // noun | verb | particle | phrase | word
  size="sm" | "md" | "lg"
  interactive             // 是否參與高亮
/>
```

`Token` 自己負責 hover → 預覽高亮、click → 釘選高亮。其他元件只組合它，不自行處理高亮。

`glossMode`（`"always"` 預設 ｜ `"hover"`）只決定 gloss 怎麼顯示、不影響高亮：`always` 是底下一行小字（文法頁、練習頁、單詞主詞卡）；`hover` 不佔版面，指到（或鍵盤聚焦）token 時它浮起約 2px、下方淡入中文小泡泡，移開即消失——觸控裝置（`hover: none`）改為釘選時才顯示，`prefers-reduced-motion` 時只顯示/隱藏不位移。目前用於今日單詞卡與單詞庫的例句 token。

### 5.2 三層高亮 store

多來源同時要求高亮時必須疊加而非互相覆蓋：

| 層 | 來源 | 視覺 | 優先權 |
|---|---|---|---|
| `hover` | 滑過任何 Token | 最強對比 + 順序徽章 | 最高，暫時性 |
| `pinned` | 點選的單詞、已排好的句子 | 中對比 + 順序徽章 | 中 |
| `context` | 本題會用到的全部假名 | 淡色底，無徽章 | 最低 |

```ts
interface HighlightState {
  hover:   HighlightSet | null;
  pinned:  HighlightSet | null;
  context: HighlightSet | null;
}
interface HighlightSet {
  sourceId: string;                        // 誰要求的
  entries: Array<{
    cellId: CellId;
    orders: number[];                      // 在來源中的第幾拍，重複假名有多個
    marks: CellMark[];                     // 徽章：dakuten / small / sokuon …
  }>;
}
```

`resolveCell(state, cellId)` 回傳 `{ layer, orders, marks, dimmed }`：`layer` 取最高命中層；`dimmed` = 三層任一存在且此格不在任何層。context 層命中時 `orders`／`marks` 回空——它只有淡色底，沒有徽章、沒有拗音連線。

未被高亮的格子**降低對比而非全暗**（opacity 約 0.4）——表格結構不能因為高亮而消失。

---

## 6. `kanaToCells` 規則表

輸入一段假名讀音，輸出逐拍的格子對映。這是全站唯一的承重轉換。

```ts
type CellId =
  | "a"|"i"|"u"|"e"|"o"
  | "ka"|"ki"|"ku"|"ke"|"ko"
  | "sa"|"shi"|"su"|"se"|"so"
  | "ta"|"chi"|"tsu"|"te"|"to"
  | "na"|"ni"|"nu"|"ne"|"no"
  | "ha"|"hi"|"fu"|"he"|"ho"
  | "ma"|"mi"|"mu"|"me"|"mo"
  | "ya"|"yu"|"yo"
  | "ra"|"ri"|"ru"|"re"|"ro"
  | "wa"|"wo"
  | "n";                                   // 共 46

type CellMark = "dakuten" | "handakuten" | "small" | "sokuon" | "chouon" | "out_of_table";

interface Mora {
  index: number;      // 第幾拍，從 0
  text: string;       // 這一拍的表記，如 "きゃ"
  cells: CellId[];    // 0～2 格
  marks: CellMark[];
  romaji: string;
}

function kanaToCells(reading: string, opts?: { particle?: boolean }): Mora[];
```

**單一入口**：助詞 override（§7）直接在 `kanaToCells` 內套用，`readingToRomaji` 只是它的薄包裝。不存在「呼叫哪一支會拿到錯誤 romaji」的問題——這是審查後的改動，原本 override 只在 romaji 層，`kanaToCells("は")` 會靜默回 `ha`。

### 規則

| # | 輸入 | 拍數 | cells | marks | 例 |
|---|---|---|---|---|---|
| 1 | 清音 46 音之一 | 1 | 自身 1 格 | — | か → `[ka]` |
| 2 | 濁音 が ぎ ぐ げ ご ざ じ ず ぜ ぞ だ ぢ づ で ど ば び ぶ べ ぼ | 1 | 清音底 1 格 | `dakuten` | が → `[ka]`゛；ぢ → `[chi]`゛；づ → `[tsu]`゛ |
| 3 | ゔ | 1 | `[u]` | `dakuten` | ゔぁ → `[u, a]` |
| 4 | 半濁音 ぱ ぴ ぷ ぺ ぽ | 1 | は行底 1 格 | `handakuten` | ぱ → `[ha]`゜ |
| 5 | 拗音：い段清音 + ゃ/ゅ/ょ | **1** | 2 格（base + や/ゆ/よ） | `small` | きゃ → `[ki, ya]` |
| 6 | 拗音：い段濁音 + ゃ/ゅ/ょ | **1** | 2 格（清音底 + や行） | `dakuten`,`small` | じゃ → `[shi, ya]` |
| 6b | 半濁音拗音：ぴ + ゃ/ゅ/ょ | **1** | `[hi, ya]` | `handakuten`,`small` | ぴゃ |
| 7 | 促音 っ | 1 | `[tsu]` | `sokuon` | がっこう 第 2 拍；romaji 為下一拍首子音（ち系為 t）。字尾或後接母音時為 `'`（あっ → `a'`），不可為空——否則與純 あ 的 `romaji_ascii` 相撞，`/bank` 搜尋無法區分 |
| 8 | 長音符 ー | 1 | `[]` | `chouon` | ラーメン 第 2 拍不亮格；romaji `""`，macron 併入前一拍 |
| 8b | 假名充當長音：おう おお うう ええ ああ | 1 | 自身 1 格 | `chouon` | とうきょう 第 2 拍亮 `u`；romaji `""`，macron 併入前一拍。**えい、いい 不算長音**（sensei、ii） |
| 9 | 外來音小書き ぁぃぅぇぉ | 併入前一拍 | 2 格 | `small` | ふぁ → `[fu, a]`；しぇ、ちぇ、じぇ、てぃ、うぃ、ゔぁ 同 |
| 9b | 孤兒小字（字首的 ゃ，或前一拍已是拗音/促音/長音/ん/表外） | — | — | — | throw `KanaInputError`。真實日文不會出現這種序列，一定是資料錯誤；靜默接受等於幫錯誤資料開後門（2026-09-12 審查後由「降級」改為 throw） |
| 10 | ん | 1 | `[n]` | — | kana.json 中 `row`/`col` 為 `""`，不佔 10×5 格位 |
| 11 | 片假名 U+30A1–U+30F6 | — | 先減 0x60 轉平假名再套 1–10 | — | ヴ → ゔ；ー 不轉換 |
| 12 | 表外假名 ゐ ゑ ヵ ヶ 與踊り字 | 1 | `[]` | `out_of_table` | UI 顯示「不在 46 音表內」；不 throw |
| 13 | 非假名字元（漢字、拉丁、標點、空白、數字） | — | — | — | throw `KanaInputError { char, index }`；`reading` 欄不允許出現 |

### 拍級 romaji 的串接原則

每一拍的 `romaji` 直接串接就是整詞的 `romaji`。因此：長音拍貢獻 `""`、macron 落在前一拍（こ→`kō`、う→`""`）；促音拍貢獻下一拍的首子音；ん 在母音或 y 之前貢獻 `n'`。

marks 順序固定：`dakuten`/`handakuten` 在前，`small` 在後。

### 拍與格的關係

`きゃ` 是**一拍兩格**。UI 必須把這件事畫出來——兩格之間拉一條連線，而不是像 `きや`（兩拍兩格）那樣各自獨立。這是拗音唯一容易教錯的地方。

重複假名（如 ここ）在同一格上疊多個順序徽章 ①③，不是亮兩次。

---

## 7. 羅馬字轉寫

採**修正ヘボン式**。兩個欄位：`romaji`（顯示用，含長音符號）與 `romaji_ascii`（搜尋/輸入比對用，純 ASCII 且忠於假名拼寫）。

### 規則

| 項目 | 規則 | 例 |
|---|---|---|
| 不規則音 | し shi、ち chi、つ tsu、ふ fu、じ ji、ぢ ji、づ zu | |
| 拗音 | しゃ sha、しゅ shu、しょ sho；ちゃ cha；じゃ ja；其餘 kya/gya/nya/hya/bya/pya/mya/rya | |
| 促音 | 重複後續子音；後接 ch 時寫 tch | まっちゃ → matcha；きって → kitte |
| 撥音 ん | 一律 n；後接母音或 y 時加隔音符 `'` | しんゆう → shin'yū；きんえん → kin'en |
| 長音 おう・おお | ō | とうきょう → tōkyō |
| 長音 うう | ū | ちゅうごく → chūgoku |
| 長音 ええ | ē | |
| えい | **保留 ei，不寫 ē** | せんせい → sensei |
| いい | ii | |
| 片假名 ー | 前一母音加長音符 | ラーメン → rāmen |
| `romaji_ascii` | 去除長音符，忠於假名拼寫 | tōkyō → `toukyou`；rāmen → `raamen` |

### 助詞例外（override）

**這是「羅馬字一律程式推導」唯一失效的地方**，必須用資料而非規則處理：

| 假名 | 一般讀音 | 作助詞時 |
|---|---|---|
| は | ha | **wa** |
| へ | he | **e** |
| を | o | o（且僅作助詞用） |

Token schema 因此需要 `romaji_override`。驗證器反向檢查：`role === "particle" && surface === "は"` 而 romaji 為 `ha` → 報錯。

API 層：`readingToRomaji(reading, { particle: true })` 對字串中每個符合條件的 は/へ 套用 override，因此 では → `de wa` 也正確。呼叫者必須按 token 分別呼叫，不可把整句丟進去。

**整句丟進去會錯的第二個理由**（2026-09-12 實測）：長音規則不知道詞界。「お金があります」整句轉換時 が＋あ 被合併成 `gā`。所以任何句子——例句、練習題、未來的使用者輸入——都必須先切成 token 再逐個轉換；§8.2 的 `example` 與 §8.3 的 `tokens` 是同一種格式，理由在此。

### 已知限制：跨語素的 おう

規則無法分辨 とうきょう（tōkyō，長音）與 思う／おもう（omou，語素邊界）。單詞層的 `romaji_override: string | null` 負責處理這類例外——非 null 時直接當作 `romaji`，`romaji_ascii` 照常推導。

**高亮仍然亮 `は` 格**（字形是 は）。這個「寫は讀wa」的落差本身是教學點，助詞頁首次出現時給註記。

---

## 8. Schema 定稿

### 8.1 `data/kana.json`

```jsonc
{
  "version": 1,
  "rows": ["", "k", "s", "t", "n", "h", "m", "y", "r", "w"],
  "cols": ["a", "i", "u", "e", "o"],
  "cells": [
    {
      "id": "ka",
      "hiragana": "か",
      "katakana": "カ",
      "row": "k",
      "col": "a",
      "romaji": "ka",
      "derived": {
        "dakuten":    { "hiragana": "が", "katakana": "ガ", "romaji": "ga" },
        "handakuten": null
      },
      "yoon": null,              // 僅い段有值
      "stroke_svg": null,        // 預留：筆順
      "audio": null,             // 預留：音檔路徑
      "mnemonic": null           // 預留：字源/記憶提示
    },
    {
      "id": "ki",
      "hiragana": "き", "katakana": "キ", "row": "k", "col": "i", "romaji": "ki",
      "derived": { "dakuten": { "hiragana": "ぎ", "katakana": "ギ", "romaji": "gi" }, "handakuten": null },
      "yoon": {
        "ya": { "hiragana": "きゃ", "romaji": "kya" },
        "yu": { "hiragana": "きゅ", "romaji": "kyu" },
        "yo": { "hiragana": "きょ", "romaji": "kyo" }
      },
      "stroke_svg": null, "audio": null, "mnemonic": null
    }
    // …共 46 筆
  ]
}
```

や行、わ行的空缺不放進 `cells`，由 `rows × cols` 與實際 id 的差集算出，渲染為空白格。

### 8.2 單詞 `data/words/YYYY-MM-DD.json`

兩個形狀，**手寫的與建置產物的不同**（型別在 `src/lib/bank/types.ts`：`WordSeed` / `Word`）：

**作者檔 `WordSeed`**——人或 AI 寫的，不含任何可推導欄位：

```jsonc
{
  "date": "2026-09-13",
  "words": [
    {
      "id": "w_0142",
      "surface": "学校",          // 表記，可能含漢字
      "reading": "がっこう",      // 假名，對映用；驗證器強制只含假名、不含表外假名
      "romaji_override": null,    // string | null；非 null 時直接取代推導的 romaji（如 思う→"omou"），romaji_ascii 仍推導
      "gloss": "學校",
      "pos": "名詞",               // 枚舉的唯一來源是 types.ts 的 POS_VALUES
      "pitch": null,               // 預留：東京式聲調核位置
      "freq_rank": 142,            // 來自頻率清單；同檔嚴格遞增、全庫不重複
      "level": "N5",
      "example": {                 // 逐 token，格式同 §8.3
        "ja": "学校まで歩いて行きます。",   // 必須等於 tokens.surface 串接 + 標點
        "zh": "走路去學校。",
        "tokens": [                // gloss 必填：該詞在本句中的繁中意思；助詞寫括號功能說明
          { "surface": "学校",   "reading": "がっこう", "gloss": "學校" },
          { "surface": "まで",   "reading": "まで", "gloss": "（到）", "particle": true },
          { "surface": "歩いて", "reading": "あるいて", "gloss": "走路" },
          { "surface": "行きます", "reading": "いきます", "gloss": "去" }
        ]
      },
      "collocations": ["学校に行く", "学校を休む"],
      "confusable_with": [],       // 易混淆詞的 word_id；必須對稱
      "note": null,                // 使用場景提醒
      "audio": null,               // 預留
      "source": "n5-freq",
      "verified": true
    }
  ]
}
```

**建置產物 `Word`**（`data/bank.json`，gitignored，由 `scripts/build-bank.ts` 產生）——在 `WordSeed` 之上加：

```jsonc
{
  "romaji": "gakkō",
  "romaji_ascii": "gakkou",
  "morae": [
    { "index": 0, "text": "が", "cells": ["ka"],  "marks": ["dakuten"], "romaji": "ga" },
    { "index": 1, "text": "っ", "cells": ["tsu"], "marks": ["sokuon"],  "romaji": "k"  },
    { "index": 2, "text": "こ", "cells": ["ko"],  "marks": [],          "romaji": "kō" },
    { "index": 3, "text": "う", "cells": ["u"],   "marks": ["chouon"],  "romaji": ""   }
  ],
  "example": {
    "tokens": [ { "surface": "学校", "reading": "がっこう", "romaji": "gakkō", "romaji_ascii": "gakkou", "morae": [/*…*/] } /*…*/ ],
    "romaji": "gakkō made aruite ikimasu"   // 各 token romaji 以空格 join
  }
}
```

`bank.json` 頂層：`{ "generated_at", "days": [{ "date", "words" }], "words": [全部展平] }`。

`data/bank.json` 由建置時合併全部 `words/*.json` 產生，不手寫、不入版控（gitignore）。

### 8.3 句子 `data/sentences/*.json`

一筆句子資料同時餵給排列練習與助詞對照器。**資料層把助詞拆開，練習層決定合不合併**。

```jsonc
{
  "id": "s_0031",
  "pattern_id": "p_15",
  "level": "N5",
  "tokens": [
    { "i": 0, "surface": "食堂", "reading": "しょくどう", "romaji": "shokudō", "gloss": "食堂",   "role": "noun" },
    { "i": 1, "surface": "で",   "reading": "で",         "romaji": "de",      "gloss": "在（動作場所）", "role": "particle", "particle_id": "de" },
    { "i": 2, "surface": "昼ご飯", "reading": "ひるごはん", "romaji": "hirugohan", "gloss": "午餐", "role": "noun" },
    { "i": 3, "surface": "を",   "reading": "を",         "romaji": "o", "particle": true, "gloss": "（受詞）", "role": "particle", "particle_id": "wo" },
    { "i": 4, "surface": "食べます", "reading": "たべます", "romaji": "tabemasu", "gloss": "吃",  "role": "verb" }
  ],
  "bunsetsu": [[0, 1], [2, 3], [4]],   // 文節切分：排列練習用的積木單位
  "valid_orders": [                     // 以 bunsetsu 索引表示
    [0, 1, 2],
    [1, 0, 2]
  ],
  "preferred_order": [0, 1, 2],
  "translation": "在食堂吃午餐。",
  "verified": true
}
```

### 8.4 助詞 `data/particles.json`

```jsonc
{
  "particles": [
    {
      "id": "wa",
      "surface": "は",
      "reading": "は",
      "romaji": "wa",
      "romaji_note": "寫作 は，讀作 wa",
      "cell": "ha",
      "class": "kakari",              // kaku（格助詞）| kakari（係助詞）| rentai（連體）
      "core": "標記這句話在談什麼",
      "zh_bridge": "≈ 中文的「這本書啊，我看過了」的「這本書」",
      "senses": [
        { "label": "主題", "example_id": "s_0002" },
        { "label": "對比", "example_id": "s_0009" }
      ],
      "contrast_with": ["ga", "mo"],
      "weight": "heavy"               // heavy 的助詞在總覽頁佔加大卡片
    }
  ],
  "contrast_sets": [
    {
      "id": "cs_wa_ga",
      "particles": ["wa", "ga"],
      "title": "は vs が：主題與焦點",
      "summary": "が 說「誰做的」，は 說「這句在談誰」——不是同一層的東西。",
      "exercise_ids": ["px_0001", "px_0002", "px_0003"]
    }
  ]
}
```

### 8.5 練習題

共用外殼，`type` 決定 renderer（registry 模式，之後加題型不動既有程式）：

```ts
type Exercise = ArrangeExercise | ParticleSwapExercise;   // 未來：Cloze | Listening | Translate
```

**排列練習**

```jsonc
{
  "id": "ax_0012",
  "type": "arrange",
  "sentence_id": "s_0031",
  "prompt_zh": "在食堂吃午餐。",
  "distractors": [],              // 可選：混入不屬於本句的積木
  "hints": ["動詞放最後"]
}
```

積木、正解、可接受序全部從 `sentence_id` 取，不重複存。

判定三值：

| 結果 | 條件 | UI |
|---|---|---|
| `natural` | 命中 `valid_orders` | ✅ 正確且自然 |
| `acceptable` | 不在 `valid_orders`，但通過規則檢查器 | ◐ 文法正確，語感不同（附說明） |
| `invalid` | 違反規則檢查器 | ✗ 不成立（指出違反哪條） |

規則檢查器（純程式，不靠資料）：
1. `verb_final` — 動詞文節必須在最後
2. `particle_attached` — 助詞必須緊跟其所屬名詞（因為積木以文節為單位，此條在排列練習中自動成立；保留給未來的自由排列模式）
3. `no_duplicate` — 每塊積木恰用一次

**助詞對照器**

```jsonc
{
  "id": "px_0007",
  "type": "particle-swap",
  "sentence_id": "s_0044",
  "slot_token_index": 1,
  "candidates": [
    { "particle_id": "to", "surface": "と", "romaji": "to",
      "verdict": "natural",   "translation": "和朋友（互相）交談", "note": "と 表相互，雙方都在說" },
    { "particle_id": "ni", "surface": "に", "romaji": "ni",
      "verdict": "different", "translation": "對朋友講（單向告知）", "note": "に 表單向，只有我在說" },
    { "particle_id": "wo", "surface": "を", "romaji": "o",
      "verdict": "invalid",   "translation": null, "note": "話す 的對話對象不用 を" },
    { "particle_id": "de", "surface": "で", "romaji": "de",
      "verdict": "marginal",  "translation": "（用朋友當手段交談）", "note": "文法可解析，但語意怪異，實際不說" }
  ],
  "focus": ["to", "ni"],
  "verified": true,
  "review": { "pass1": "...", "pass2": "...", "agreed": true }
}
```

`verdict` 四值：`natural` / `different`（文法對、語意不同）/ `marginal`（可解析但不自然）/ `invalid`（不成立）。
四值比對錯二值誠實——助詞的真相就是「好幾個都對，但講的是不同的事」。

### 8.6 進度層

第一版 localStorage，但先抽成 interface，未來換帳號同步只換實作：

```ts
interface ProgressStore {
  getKana(cellId: CellId): KanaProgress;         // seen / correct / lastSeen
  getWord(wordId: string): WordProgress;
  record(event: ProgressEvent): Promise<void>;
  export(): Promise<string>;                      // JSON，供備份與未來遷移
}
```

所有進度掛在 `cellId` 與 `word_id` 上——**這兩個 ID 一旦發佈就不能改**，之後的 SRS 排程、錯題、音檔檔名全部依賴它們。

---

## 9. 內容管線

### 9.1 流程

```
頻率清單（固定）──┐
                  ├─→ scripts/generate-daily.ts ──→ Claude 加工 ──┐
句型模板（固定）──┘                                                │
                                                                   ▼
                                              scripts/validate.ts（純程式）
                                                                   │
                                        ┌──────────────────────────┴───────────┐
                                     通過                                    失敗
                                        │                                      │
                             scripts/cross-check.ts                    data/pending/
                            （二次 AI，不看第一次理由）                   （人工處理）
                                        │
                          ┌─────────────┴──────────┐
                      兩次一致                   不一致
                          │                        │
                 verified: true → 上線        data/pending/
```

原則：**骨架固定，AI 填內容**。AI 不決定學什麼，只決定怎麼講。

### 9.1a 逐詞重試與替補（2026-09-17）

上面的流程圖有一個隱藏假設：一天 10 詞是「整批」處理——AI 加工一次、驗證一次、cross-check 一次，一詞失敗就整天作廢，寫進 `pending/` 等人工。2026-09-16、09-17 兩晚的 cron 都跑了、都失敗，而且兩天選到的是**同一批** 10 詞（頻率表 rank 51–60）：09-16 一詞（「一」的例句「番号は一です」用了超綱漢字「号」）驗證失敗，整天作廢；09-17 因為 09-16 沒有任何詞上線，選詞邏輯照樣選中同一批，AI 對「一」又寫出幾乎一樣的例句，再度用了「号」——因為 AI 完全不知道昨天為什麼被退。兩天，零新詞。

修法是把「整批批次」改成「逐詞嘗試、失敗重試、仍失敗則替補下一個候選」：

- `MAX_ATTEMPTS_PER_WORD = 3`（1 次 + 2 次重試）、`MAX_CANDIDATES = 14`：候選池取頻率表中尚未上線、依 rank 升冪的最多 14 個詞（不是固定 10 個），逐一嘗試，直到湊滿 `WORDS_PER_DAY`（10）個或候選池用盡。
- 對每個候選：`enricher.enrich()` → `validateWordStandalone()`（程式驗證，回傳這個詞的**全部**問題，不是只回傳第一個）→ 通過才 `judge.judge()`。任一步失敗，problems 變成下一次 `enrich()` 呼叫的 `feedback`，同一個詞重試，最多 3 次。三次都失敗就跳過（記進 `skipped`），換下一個候選——被跳過的詞沒有上線，隔天自然又是候選池第一順位，不另外做黑名單。
- `enrich()` 的請求多帶兩個欄位：`allowed_kanji`（目前已知範圍內的漢字全部串接）與 `feedback`（上一次嘗試的問題列表，第一次為空）。兩個 provider（openrouter.ts / claude.ts）的 system prompt 都會把這兩者轉成白話指示：「例句漢字只能用 allowed_kanji 裡的字，範圍外的詞請改寫平假名」「上一次被退回的原因是……，請不要重複同樣的錯誤」。這是讓 AI 真正「學到教訓」而不是每天原地重犯的關鍵——單純把壞例句丟進 pending 等人工，不會讓下一次的 AI 呼叫變聰明。
- **系統性錯誤（`AiProviderError` 的 kind 為 `auth`／`http`／`network`）立即中止整個執行**，不重試、不替補——這類錯誤代表 API 本身出問題，繼續嘗試下一個候選只會把同樣的錯誤重複 14×3 次，沒有意義。已接受的詞連同錯誤一起寫進 `pending/`，exit 2。`schema`／`truncated`／`refusal`（模型輸出本身有問題，不是連線問題）則視為這個詞這次嘗試的失敗，照常重試。
- 接受的詞最後依 rank 排序、重新配發連續 id，確保 `freq_rank` 嚴格遞增、id 連續——候選是依 rank 嘗試的，但哪些詞會被跳過事先不知道，id 必須等最終名單確定才配。
- pending 檔的 `pipeline` 多兩個欄位：`attempts`（每個嘗試過的候選，每次嘗試的階段與問題）、`skipped`（最終被跳過的候選與其問題），方便人工或下一次的 AI 呼叫回顧「這批到底發生了什麼」。

`validateWordStandalone`（`scripts/lib/validate-words.ts`）是這次修法新增的驗證入口：對「一個詞」回傳它的**全部**問題（zod 形狀、`enrichWord` 的各種檢查、例句超綱漢字、例句與既有/同批詞重複），而不是像 `fail()`／`BuildError` 那樣遇到第一個問題就丟出例外中止。`validateWordFile`／`build-bank.ts` 既有的行為與錯誤訊息完全不變（既有測試逐字比對它們）——`validateWordStandalone` 是平行的新函式，不是重構。`scripts/cross-check.ts` 對 pending 檔的程式驗證也改成先跑 `validateWordStandalone` 印出每個詞的全部問題，再跑 `validateWordFile` 做跨檔案的結構檢查（id/surface+reading/freq_rank 唯一性、confusable_with 對稱）；後者維持「遇到第一個問題就停」，但此時多半已經沒有問題可停了。

### 9.2 驗證器能查的（純程式，無 AI）

- `reading` 只含假名（`kanaToCells` 回傳含 `out_of_table` 或非假名 → 失敗）
- `romaji`／`romaji_ascii` 一律由建置腳本從 `reading` 推導，作者檔不填；`romaji_override` 非 null 時取代 `romaji`。助詞 token 的 wa/e/o 由 `particle: true` 觸發（§7）
- `reading` 含表外假名（`out_of_table` mark：ゐ ゑ ヵ ヶ 踊り字）→ 失敗；孤兒小字與非假名字元由 `kanaToCells` throw，錯誤訊息分別指出「序列不合法」與「非假名」
- `romaji_ascii` 為純 ASCII
- 單詞不與現有 bank 重複（`surface` + `reading` 為鍵）
- 例句 `tokens` 的 `particle: true` 必須在助詞白名單內（は が を に で と の も へ か から まで や ね よ でも には では とか）；反向：surface 恰為 は/を/へ/が 的獨立 token 未標 particle → 失敗。**這是弱模型照範本產詞時最容易靜默寫錯的欄位**（2026-09-12 審查：誤標會讓 romaji 變 wana 而 build 不紅）
- 例句每個 token 必須有 `gloss`，trim 後非空（該詞在本句中的繁體中文意思；助詞寫「（主題）」「（受詞）」這類括號功能說明）→ 缺少或空白即失敗，錯誤指到 `file / id / example.tokens[i]`
- 例句 token 的 `gloss` 不得含平假名／片假名（U+3040–30FF，「ー」也算；片假名中點「・」視為標點放行），中文標點與括號不受限 → 攔 AI 把讀音當意思填（如「たべる」）
- `example.ja` 去標點後必須等於 `tokens.surface` 串接
- `freq_rank` 同檔嚴格遞增且全庫不重複；`confusable_with` 必須對稱
- 例句範圍：非助詞 token 的 surface 所含漢字必須出現在頻率表或既有 words/ 的 surface 中（漢字集合比對，不受活用影響）；例句 `ja` 跨全庫唯一。（2026-09-14 審查：AI 在無人看管的批次模式下最容易犯的兩種錯——超綱例句、對相似詞複製同一句——原清單攔不到）
- 純假名 surface 的 reading 必須與 surface 是同一組假名（平／片假名視為相同，比對前去掉標點與引號）；助詞 は/へ/を 的 reading 寫字形本身，發音交給 `particle: true`。適用單詞例句與所有句子資料。（2026-09-15：第一次真實產詞的兩天裡，AI 兩度把助詞 へ 的 reading 寫成 え——五十音表因此亮 え 格而不是 へ 格，是在教錯字形；Gemini judge 沒抓到，所以必須機檢）
- 覆寫守門：`generate-daily` 對已存在的 `words/<date>.json` 一律拒絕（正式資料不由腳本覆寫）；對已存在的 `pending/<date>.json` 拒絕，除非 `--force`（人工編輯過的 pending 要用 `cross-check.ts` 重驗，不是重產）
- 權威來源：新詞的 `gloss`／`pos` 取自頻率表；已 promote 的詞以 `words/` 為準，頻率表事後的修改不回寫
- 句子的動詞 token 在最後；`bunsetsu` 覆蓋全部 token 恰一次
- `valid_orders` 中每個序都通過規則檢查器
- 助詞候選的 `particle_id` 在八大之內；至少一個 `natural`
- JSON schema（zod）

**驗證失敗要讓 CI 紅**，不是照樣 commit。網站在當日檔缺失時顯示「今日詞尚未產生」，不是白畫面。

### 9.3 二次交叉驗證

只用於語感判斷（助詞 verdict、例句自然度）。第二次呼叫**不提供第一次的理由**，只給句子與候選，獨立判讀。兩次的 verdict 不一致 → 進 `pending/`。

**已知的系統性誤判模式**（2026-09-13 手工種子審查：48 個候選中 2 個 P0 都是同一種錯）：出題者看到某候選「不是這題要教的那個助詞」就直覺判 `invalid`，沒有檢查它是否構成**另一個同樣成立、只是語意不同**的句子。「中国語**を**話します」「先生**が**手紙を書きます」都被誤判成不成立。這種錯誤結構驗證完全攔不到——`verdict` 的語意正確性沒有機檢。因此產題與交叉驗證的 prompt 都必須明確問一句：「把這個助詞放進去，會不會變成一個文法成立但意思不同的句子？會 → `different`，不是 `invalid`。」

一致才 `verified: true`。UI 上 `verified: false` 的項目帶淡色「未校對」標記——與知識庫裡對 `[d4]` 的處理是同一個問題的同一個解法。

### 9.4 手工種子

第一版先手工校過 20–30 個單詞與 20–30 題文法。這不是浪費：它同時是驗證器的測試資料、AI 的 few-shot 範例、以及題型手感的驗證。

---

## 10. 句型模板清單

`data/patterns.json` 的初始內容。全部 N5 範圍，依助詞焦點排序而非依教科書順序。

| id | 模板 | 例 | 助詞焦點 |
|---|---|---|---|
| p_01 | NはNです | 私は学生です | は |
| p_02 | NはNではありません | 私は先生ではありません | は |
| p_03 | NはNですか | あなたは学生ですか | は |
| p_04 | NもNです | 私も学生です | も |
| p_05 | NのN | 私の本 / 日本語の先生 | の |
| p_06 | これ/それ/あれはNです | これは本です | は |
| p_07 | NはA(い)です | この本は面白いです | は |
| p_08 | NはA(い)くないです | この本は面白くないです | は |
| p_09 | NはNA(な)です | ここは静かです | は |
| p_10 | A(い)N ／ NA(な)なN | 面白い本 / 静かな部屋 | —（連體修飾） |
| p_11 | NにNがあります／います | 机の上に本があります | に・が |
| p_12 | NはNにあります／います | 本は机の上にあります | は・に |
| p_13 | NはVます | 私は行きます | は |
| p_14 | NはNをVます | 私はパンを食べます | は・を |
| p_15 | NでNをVます | 食堂で昼ご飯を食べます | で・を |
| p_16 | Nへ／にVます（移動） | 学校へ行きます | へ・に |
| p_17 | NにNをVます（對象） | 友達に手紙を書きます | に・を |
| p_18 | NとVます（共同） | 友達と話します | と |
| p_19 | NでVます（手段） | バスで行きます | で |
| p_20 | Nから NまでVます | 九時から五時まで働きます | から・まで |
| p_21 | 時間にVます | 七時に起きます | に |
| p_22 | NがVます（現象・新資訊） | 雨が降ります | が |
| p_23 | NはNがA／V | 私は日本語が好きです | **は・が（重點）** |
| p_24 | NをVたいです／NがVたいです | 水を／が飲みたいです | **を・が（重點）** |
| p_25 | NとN（並列） | パンと牛乳 | と |
| p_26 | NのNのN（連鎖） | 日本語の先生の本 | の |
| p_27 | Vて、V ／ VてからV | 起きてから食べます | —（接續） |
| p_28 | NよりNのほうがA | 電車より車のほうが速いです | より・のほうが |

p_23 與 p_24 是 は/が、を/が 對照的主要載體，題目密度應高於其他句型。

---

## 11. 與 `~/fluency-forge` 的關係

同一位使用者的既有專案，Next.js + Supabase + Claude API，約 23k 行、完成度 85%。**不在其上開發**，理由：

- 它的世界觀是「已有基礎、把句型練成反射」；最小知識單位是 scenario → pattern，全部由 Claude 針對使用者情境即時生成、用完即丟。
- 本站的核心是「固定的、有限的、要按表學完的字符集與教材」。五十音表在它的資料模型裡無處安放——`vocab_items` 連 `reading` 欄位都沒有。
- `DrillType` union 在 4 個檔案各寫一次；出題品質過濾用空白斷詞判「≤15 詞」，對日文直接失效。要改的是判分核心。
- 還會繼承一整套用不到的東西（Streets 角色扮演約 1000 行、鍛造爐世界觀文案、成就系統），刪比寫累。

**但它是零件庫**，以下值得直接抄過來改，不要重寫：

| 零件 | 位置 |
|---|---|
| Leitner 五盒 SRS 與排程 | `~/fluency-forge/lib/srs/` |
| Levenshtein 本地判分（近似答案的 graze zone） | `~/fluency-forge/lib/gym/levenshtein.ts` |
| Supabase schema 與 RLS（若日後要帳號） | `~/fluency-forge/supabase/migrations/001_initial_schema.sql` |
| UI 元件庫（深色系，已調校） | `~/fluency-forge/components/ui/` |
| Claude 出題的重試 + zod 驗證 + fallback 模式 | `~/fluency-forge/app/api/gym/generate/route.ts` |

---

## 12. 建置順序

| # | 內容 | 產出 |
|---|---|---|
| 1 | `data/kana.json` + `kanaToCells` + `romaji` + 測試 | 純函式，含濁音/拗音/促音/長音/片假名/助詞 override 全部案例 |
| 2 | `Token` 元件 + 三層高亮 store + `KanaTable` | 全站地基，三者一起做 |
| 3 | 今日單詞頁（手工種子 30 詞） | 地基的第一個消費者，驗證手感 |
| 4 | 語序說明頁 + 八助詞說明頁 | 靜態內容，手寫，不靠 AI |
| 5 | 排列練習 + 助詞對照器（手工種子 30 題） | `Exercise` registry 的頭兩種 renderer |
| 6 | 內容管線：頻率表、`generate-daily`、`validate`、`cross-check` | 自動化 |
| 7 | GitHub Actions cron + 部署 | |
| 8 | `/bank`、`/kana/:id`、進度層、`verified` 標記 UI | |

第 5 步完成即可實際使用。第 6 步之前全部靠手工種子，這是刻意的。

---

## 13. 未決事項

- **頻率清單來源**：傾向 N5 詞表（約 800 詞，順序對初學者合理）打底，之後接一般頻率表。待確認是否照 JLPT 節奏走。
- **Claude API key**：第 1–5 步完全不需要；第 6 步才要放進 repo secrets。
- **部署平台**：Cloudflare Pages 或 GitHub Pages，兩者皆可，待定。
- **は/が 是否獨立成頁**：第一版先在總覽頁給加大卡片，觀察後再決定拆不拆。

---

## 14. 擴充（2026-09-24 起）

### 14.1 五十音練習 `/practice/kana`

- **題量與題型**：每天 30 題，兩種題型：看假名選羅馬字、看羅馬字選假名。各題 3 個選項，干擾項優先取形近與音近的假名（`src/lib/quiz/confusables.ts`）。
- **決定性**：`dailyKanaQuiz(dateKey, cells)` 以日期為種子，同一天任何裝置、任何重整都得到同一組題。
- **不重複**：任意連續 10 題內，同一個假名不會出現兩次（`slidingWindowOk` 有測試覆蓋）。
- **を 的處理**：を 不當「羅馬字→假名」的正解，因為題幹 o 同時對應 お。它仍會出現在「假名→羅馬字」題。
- **偷看**：此路由下五十音表預設收合。打開桌面側欄或手機抽屜，當題即記為「偷看」，允許但會被記錄。
- **進度**：存 localStorage，鍵為 `kana-quiz:<dateKey>`，一天一筆。

### 14.2 閱讀器 `/texts`

- **流程**：貼上文本（上限 4000 字）→ 依句切段（每段目標 800 字，不切斷句子）→ 每段一次 OpenRouter 請求 → zod 驗證 → 存檔。
- **模型**：預設 `google/gemini-3.8-flash`，可在設定頁改。key 與模型都存該裝置的 localStorage，程式不內建任何 key。
- **不信任 AI 的欄位**：羅馬字一律本地由 reading 推導。reading 無法轉換的詞標為 invalid，仍顯示但不連動五十音表。翻譯片段的 token_indices 先過濾越界與重複。
- **對齊**：翻譯切成片段，每段指向零到多個 token。滑過 token 會亮對應譯文，反之亦然。
- **可續傳**：每段成功就立刻寫入，失敗或關頁後，剩下的段落記在 pendingSegments，可從詳頁續跑，已付費的段落不會白費。
- **儲存**：IndexedDB；不可用時退回記憶體並顯示警示。可刪除單篇；設定頁可匯出/匯入全部文本與「我的單詞」。
- **擷取**：AI 列出詞彙、文法、助詞。使用者逐項勾選加入「我的單詞」，出現在 `/bank`，與每日單詞分開存放，同樣永不自動刪除。

### 14.3 文法擴充

- **資料模型**：`data/grammar/items*.json` 與 `contrasts*.json` 由 build-bank 以檔名前綴多檔載入並合併。GrammarItem 分類為 case／focus／conjunctive／final／conjunction／expression，每個義項指向例句 id。
- **涵蓋範圍**：格助詞 が を に で へ と から より の；副助詞 は も だけ しか まで ほど さえ；接續 ので けど たら；終助詞 ね よ；接續詞 しかも それに そして それから で/それで；句型 〜し〜し、まさか、なんと、〜も（強調數量）、〜なんて/〜とは。
- **標點 token**：例句可含 `{surface:"、", reading:""}`。標點不產生羅馬字、不需 gloss、不能標為助詞，也不當述語。
- **相容層**：`bank.particles` 仍只輸出原八大助詞，contrast_with 與對照組都只保留八者之間的連結，供舊頁面使用。
- **動詞**：`src/lib/grammar/conjugate.ts` 支援五段、一段、する、来る × 辭書形、ます、ない、て、た，對照手寫表測試。`/grammar/verbs` 另列一段動詞的外觀例外（帰る、入る、走る…）與て形音便表。
- **動詞清單**（2026-09-25）：183 個常用動詞，五段依詞尾分組、一段依い段/え段分組、「看似一段其實五段」由資料推導（`src/lib/grammar/verbGroups.ts`）。每個動詞是 Token：滑過顯示中文並高亮五十音，點選切換活用面板。新增動詞的活用期望寫在 `src/lib/grammar/__tests__/fixtures/verb-readings.ts`，同樣手寫、不由引擎產生。
- **可能形・意向形**（2026-09-25）：`conjugate()` 新增 potential／volitional／volitional_polite；可能動詞一律當一段再活用（`potentialVerb()`）。非意志動詞以 verbs.json 的 `lacks`／`lacks_note` 標記，面板改顯示原因。手寫期望在 `fixtures/verb-pot-vol.ts`。意向形的羅馬字另外組（`volitionalRomaji`），避免 おもおう 被合併成 omōu；思う・拾う・吸う 的辭書形用 `romaji` 覆寫（§7 已知限制）。
- **なん**：expression 類的新項目，整理 〜なんです／なんだ、助詞 なんか（已加入助詞白名單）、何か 的口語 なんか、何 讀 なん／なに 的規則，與 〜なんて 互相對照。
- **導覽**：`/grammar` 頂端是分類索引表與下拉選單（`src/components/GrammarPicker.tsx`），各文法頁與動詞頁頂端也有同一個下拉選單。
- **內容把關**：兩批內容各由獨立審查逐句檢查，修正紀錄見 git log（「依獨立審查修正文法內容 A／B」）。
