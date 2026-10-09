# V8 型の対応表（パターン台帳）

- 作成：2026-10-09（オーナー「見落としていて決まりから外れているところが、次回から外れないように、同じものとして認識されるようにしておいて」・B-143・B-168・B-172）
- 何の文書か：**同じ役目の物を、画面が違っても同じ物として見つける**ための表。型ごとに「役目・持ち主（正の部品）・見つけ方・決まり・見張り」を1節で書く。
- 誰が読むか：画面を作る・直す人（Codex・Claude・Pen の作業役）と、点検の道具。機械が読む表は `scripts/visual-qa/v8-pattern-catalog.json`（この文書と同じ中身。正規表現は JSON が正）。
- 点検の道具：`node scripts/visual-qa/v8-pattern-audit.mjs --code ~/lh-work/lh-train-12 --pen ~/lh-work/design/v8/html --out ~/lh-work/design/v8/review/pattern-audit-run`（`--only card,kpi-band` で型を絞る）。
- 決まりの正本は `docs/v8-design-rules.md`。この文書は決まりを増やさない。決まりの節と B-番号へつなぐだけ。

## 使い方（必ず守る）

1. **画面を作る・直す前に**、その画面に出る型をこの表で探し、**持ち主（正の部品）だけを使う**。画面の中で同じ役目の物を書かない（§2・§6.20）。
2. **画面の CSS で部品の見た目を上書きしない**。部品に見た目の `className`・`style` を渡さない（幅・余白・並びは呼び出し側が渡してよい＝§5）。色・大きさ・角丸・影を直書きしない（変数を読む）。
3. **Pen の板は部品の写しだけ**を使う。切り離し・見た目の上書きをしない（文字・件数・データの違いだけ上書きしてよい）。
4. **直すときは持ち主だけを直す**。画面ごとに直したくなったら型が足りない合図。**この表に型（または部品の変わり形）を足してから**直す（B-172）。
5. **新しい役目の物を作るとき**は、先にこの表と JSON に型を足す（id・役目・持ち主・見つけ方・決まり・見張り）。足したら道具を回して候補の数を記録する。

## 点検の4つの数（B-172）

| 記号 | 何を数えるか | どこで |
|---|---|---|
| (a) 手書き | 持ち主以外で同じ形を作っている所（下の「見つけ方（コード）」の目印に当たった所。共通部品・型の中は除く） | file:line |
| (b) 上書き | 持ち主の部品に見た目の `className`・`style` を渡している所（渡したクラスの規則に色・枠・角丸・影・文字があるもの）／画面の `.module.css` が部品の中を `:global(.x)`・子孫の要素・`[data-variant]` などで塗り直している所 | file:line |
| (c) 直書き | 画面の CSS に、色・大きさ（文字・高さ・幅）・角丸・影を変数なしで書いた所。型は selector の手がかりで割り当て、当たらない分は「（型なし）」 | file:line |
| (d) Pen | 手描きの目印（下の「見つけ方（Pen）」）と、持ち主の部品の写しの見た目の上書き（`background-color・outline・box-shadow・border-radius` が写しで一番多い値と違う）・切り離し（ほかの写しに無い中身） | 板 ID |
| 効く範囲 | 持ち主を直すと変わる所：持ち主の部品を読む画面側のファイル数・機能の数、Pen は写しを置いた板の数 | — |

- 数はどれも**候補**。理由のある例外も混ざるので、直す前に目で確かめる。数を減らすために目印を外さない（外すときは理由をこの文書に書く）。
- Pen の部品の板の html（`~/lh-work/design/v8/html/components-*.html`）は 10-04 の書き出しで古い。そのため (d) の写しは「部品の板の値」ではなく「同じ名前の写しで一番多い値」と比べる。部品の板を書き出し直したら、部品の値と比べる形に戻せる。
- 道具そのものの試験：`scripts/visual-qa/v8-pattern-audit.test.ts`（偽の一致・見落としを作りものの repo と板で確かめる。持ち主のファイル・見張りの試験のファイルが実在するかも見る）。

## 型の一覧（2026-10-09 の点検の数）

数は `~/lh-work/lh-train-12`（本線＋列車11・12）と Pen の板 632 枚。(a) の括弧は v8 の置き場だけの数。

| 型 | 持ち主 | (a) | (b) | (c) | (d) 手描き／写し | 効く範囲（ファイル／機能／Pen 板） |
|---|---|---|---|---|---|---|
| [card](#card) カード（中身のまとまりの箱） | 未定：Pen | 45（37） | 22 | 204 | 186／0 | 63／37／0 |
| [kpi-band](#kpi-band) 数の帯 | 決まっている | 163（113） | 55 | 270 | 0／0 | 149／64／15 |
| [page-head](#page-head) 一覧・画面の頭 | 決まっている | 158（109） | 4 | 216 | 26／149 | 169／74／505 |
| [toolbar](#toolbar) 一覧の道具の段 | 決まっている | 227（170） | 1 | 9 | 157／3 | 36／29／191 |
| [filter](#filter) 絞り込み | 決まっている | 190（90） | 28 | 29 | 37／5 | 116／55／40 |
| [folder-column](#folder-column) フォルダの列 | 決まっている | 83（60） | 1 | 32 | 19／0 | 16／13／0 |
| [table](#table) 表 | 決まっている | 546（458） | 581 | 204 | 4／20 | 223／81／86 |
| [row-menu](#row-menu) 行の右端「…」 | 決まっている | 109（53） | 31 | 9 | 0／0 | 132／68／0 |
| [pagination](#pagination) ページ送り | 決まっている | 222（126） | 0 | 12 | 8／0 | 155／71／56 |
| [detail-panel](#detail-panel) 詳細のパネル・引き出し | 未定：Pen | 140（73） | 3 | 14 | 13／0 | 41／29／0 |
| [dialog](#dialog) 窓（確かめ・編集） | 決まっている | 109（32） | 18 | 41 | 6／0 | 354／109／0 |
| [picker-dialog](#picker-dialog) 選ぶ窓 | 決まっている | 2（1） | 1 | 1 | 3／0 | 2／1／0 |
| [picker-field](#picker-field) 選ぶ欄（選ぶ前・選んだ後） | 未定：Pen | 137（71） | 0 | 2 | 64／0 | 7／4／0 |
| [select](#select) プルダウン（許される範囲） | 決まっている | 154（88） | 33 | 18 | 12／3 | 376／111／97 |
| [tap-action](#tap-action) 押したら（TapActionField） | 決まっている | 44（29） | 0 | 1 | 0／0 | 6／6／0 |
| [tap-extra](#tap-extra) 押されたときにあわせて行うこと | 決まっている | 48（27） | 0 | 0 | 0／0 | 6／6／0 |
| [action-list](#action-list) 行うことを足す | 未定：コード・Pen | 34（16） | 0 | 8 | 24／0 | 0／0／0 |
| [media-slot](#media-slot) 画像の枠（MediaSlot） | 未定：Pen | 81（41） | 1 | 11 | 0／0 | 26／16／0 |
| [field](#field) 欄（Field・必須・任意・文字数） | 決まっている | 804（332） | 52 | 196 | 1／4 | 269／91／104 |
| [field-error](#field-error) 欄の赤表示 | 決まっている | 704（477） | 14 | 31 | 0／0 | 43／27／0 |
| [sticky-bar](#sticky-bar) 作る・編集の下の帯 | 未定：Pen | 260（162） | 5 | 15 | 30／0 | 126／72／0 |
| [tabs](#tabs) タブ | 決まっている | 86（52） | 19 | 13 | 130／13 | 80／51／132 |
| [status-badge](#status-badge) 状態の札 | 決まっている | 436（268） | 81 | 54 | 306／10 | 125／56／178 |
| [list-state](#list-state) 空・読めない・読み込み中 | 決まっている | 816（475） | 13 | 17 | 31／0 | 430／115／1 |
| [viewer-band](#viewer-band) 閲覧のみの帯 | 未定：コード・Pen | 248（239） | 0 | 10 | 8／0 | 0／0／0 |
| [notice](#notice) 知らせ（トースト・Notice） | 決まっている | 195（62） | 0 | 20 | 23／0 | 394／112／23 |
| [save-conflict](#save-conflict) ぶつかりの帯 | 未定：Pen | 223（131） | 2 | 8 | 0／0 | 12／11／0 |
| [customer-info](#customer-info) 顧客情報の欄 | 未定：コード | 20（9） | 0 | 0 | 20／0 | 0／0／0 |
| [phone-preview](#phone-preview) スマホのプレビュー | 決まっている | 76（37） | 3 | 88 | 29／0 | 58／31／2 |
| [period](#period) 期間の選択 | 未定：コード・Pen | 166（95） | 0 | 3 | 73／0 | 0／0／0 |
| [chart](#chart) グラフ | 未定：Pen | 16（7） | 0 | 22 | 108／0 | 2／1／0 |
| [external-link](#external-link) 外へのリンク | 決まっている | 85（47） | 0 | 48 | 57／0 | 4／1／13 |
| [csv](#csv) CSV | 未定：コード・Pen | 158（93） | 0 | 0 | 80／0 | 0／0／0 |
| [primary-button](#primary-button) 主ボタン・ボタン | 決まっている | 96（49） | 279 | 81 | 464／18 | 698／151／277 |
| [date-time](#date-time) 日付・時刻の欄 | 未定：Pen | 86（43） | 7 | 12 | 0／0 | 102／48／0 |
| [toggle](#toggle) オン・オフ・選ぶ部品 | 決まっている | 247（162） | 26 | 18 | 0／0 | 265／98／87 |
| [copy](#copy) コピー | 未定：Pen | 47（25） | 0 | 0 | 0／0 | 2／1／0 |
| [steps](#steps) 手順 | 決まっている | 34（23） | 9 | 77 | 85／2 | 20／19／19 |
| [bulk-bar](#bulk-bar) まとめて選ぶ（一括バー） | 決まっている | 11（7） | 0 | 6 | 3／0 | 12／9／0 |
| [back-link](#back-link) ページ内の戻る（置かない） | 未定：Pen | 53（43） | 0 | 6 | 0／0 | 11／6／0 |
| [folder-select](#folder-select) 所属フォルダを選ぶ欄 | 決まっている | 61（45） | 0 | 0 | 0／0 | 25／18／0 |

---

<a id="card"></a>
## card カード（中身のまとまりの箱）

- **役目**：中身のまとまりを白地＋薄い縁＋影＋角丸12で1枚に見せる
- **持ち主（コード）**：`apps/web/src/components/shared/card.tsx`・`apps/web/src/components/shared/card.module.css`（部品 `Card`・`CardHeader`）
  - 読む変数：`--card-shadow`・`--card-edge`・`--radius-card`
- **持ち主（Pen）**：**未定**
  - 注：Pen にカードの部品が無い（B-168「Pen もカードは部品のカードだけ」の部品を作る）
- **見つけ方（コード）**：
  - ring-card：CSS の規則に `border-radius:\s*(12px|var\(--radius-card\))` と `box-shadow:\s*var\(--tpl-[\w-]*ring\)|border:\s*1px solid var\(--color-(hairline|divider|border[\w-]*)\)|outline:\s*1px` があり、`--card-shadow` が無い — カードの角丸で線だけ（影なし）の箱（B-168）
  - own-shadow-card：CSS の規則に `border-radius:\s*(12px|var\(--radius-card\))` と `box-shadow:\s*(0|[^;v]*rgba|var\(--shadow-card)` があり、`--card-shadow` が無い — カードの角丸で別の影の箱
  - (c) の割り当て：直書きの selector が `card|panel|box|tile|section\b|sheet|block` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - outline-card：名前が `^(知らせ|選ぶカード|選ぶ欄|ポップ|吹き出し|ダイアログ|窓)` でない・style に `border-radius: 12px` と `background-color: #ffffff` と `outline: 1px`・style に `0px 1px 1px #1d1d1f29`・`0px 8px 24px` が無い — 白地・角丸12・線だけで影なし（カードの部品を使わない手描き）
- **決まり**：[§6.2](v8-design-rules.md)・[§6.18](v8-design-rules.md)・B-137・B-148・B-168
- **見張り**：なし／**要る試験**：画面の .module.css に「角丸がカードの値・枠だけ・--card-shadow なし」の規則を新しく書いたら落ちる試験（例外は一覧に理由つき。B-168）
- **10-09 の数**：(a) 45（v8 37）・(b) 22・(c) 204・(d) 手描き 186（73 板）／写し 0・効く範囲 63 ファイル／37 機能／Pen 0 板

<a id="kpi-band"></a>
## kpi-band 数の帯

- **役目**：数（KPI）を線で区切った1本の帯で並べる
- **持ち主（コード）**：`apps/web/src/components/shared/kpi-band.tsx`・`apps/web/src/components/shared/kpi-card.tsx`・`apps/web/src/components/shared/kpi-card.module.css`・`apps/web/src/components/shared/kpi-band-v8.css`・`apps/web/src/components/shared/list-kpis.tsx`（部品 `KpiBand`・`KpiCard`・`ListKpis`）
  - 読む変数：`--color-hairline`
- **持ち主（Pen）**：`Pp3nS`「数のマス」
- **見つけ方（コード）**：
  - own-stat：`\b(function|const)\s+(StatCard|Stat|MiniStat|Kpi|KpiMenu|StatTile|Metric|SummaryCard)\b` — 画面で数のマスを自作（KpiCard を使う）
  - cards：`presentation=["']cards["']` — 数の並びをカードにしている（B-153 は線の帯）
  - kpi-class：`styles\.(kpi|stat|stats|kpis|metric|metrics|summaryCards?)\b`（持ち主の部品を読んでいないファイルだけ） — 数の帯を CSS で手書き
  - (b) の割り当て：画面の CSS の上書きの selector が `kpi|stat` に当たればこの型
  - (c) の割り当て：直書きの selector が `kpi|stat|metric|summary(Cell|Item)|count(Cell|Box)` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - kpi-card：名前 `数のカード|^数 `・style に `box-shadow: 0px 1px 1px #1d1d1f29` — 数のカード（影の箱）で数を並べている
- **決まり**：[§6.7](v8-design-rules.md)・[§6.1](v8-design-rules.md)・B-149・B-153・B-145
- **見張り**：`apps/web/src/components/shared/kpi-band-contract.test.tsx`・`apps/web/src/components/shared/kpi-card-migration-contract.test.tsx`・`apps/web/src/components/shared/list-kpis-contract.test.ts`
- **10-09 の数**：(a) 163（v8 113）・(b) 55・(c) 270・(d) 手描き 0（0 板）／写し 0・効く範囲 149 ファイル／64 機能／Pen 15 板

<a id="page-head"></a>
## page-head 一覧・画面の頭

- **役目**：板の題・「？」・右の主ボタンを1段で出す
- **持ち主（コード）**：`apps/web/src/components/templates/page-frame.tsx`・`apps/web/src/components/shared/page-header.tsx`・`apps/web/src/components/shared/help-tip.tsx`（部品 `PageHeading`・`PageTitle`・`PageFrame`・`ListPage`・`CreatePage`・`DetailPage`・`DashboardPage`・`SettingsPage`・`AnalyticsPage`・`InboxPage`）
  - 読む変数：`--text-title`
- **持ち主（Pen）**：`EnlYo`「板の頭」・`KjC1z`「？」
- **見つけ方（コード）**：
  - raw-h1：`<h1\b`（持ち主の部品を読んでいないファイルだけ） — 題を h1 で手書き（型の PageHeading を使う）
  - header-desc：`<PageHeader\b(?:[^<>]|=>){0,400}?\bdescription=` — 頭の下の説明（B-158 の 2：説明は「？」へ）
  - lead：`className=\{styles\.(lead|subtitle|pageDescription|headDescription|intro)\}` — 題の下の説明の行
  - (b) の割り当て：画面の CSS の上書きの selector が `heading|pageHead` に当たればこの型
  - (c) の割り当て：直書きの selector が `pageHead|heading|header\b|title\b|lead|subtitle|description` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - desc-line：名前 `^説明の行$|^説明$`・祖先の名前 `^板の頭|^頭$` — 頭の下の説明の行（「？」へ入れる）
- **決まり**：[§5](v8-design-rules.md)・[§6.12-2](v8-design-rules.md)・B-158
- **見張り**：`apps/web/src/components/shared/page-header-enlyo-contract.test.ts`・`apps/web/src/components/templates/page-templates-head-contract.test.ts`
- **10-09 の数**：(a) 158（v8 109）・(b) 4・(c) 216・(d) 手描き 26（17 板）／写し 149・効く範囲 169 ファイル／74 機能／Pen 505 板

<a id="toolbar"></a>
## toolbar 一覧の道具の段

- **役目**：検索→絞り込みの札→並び→右端に件数の切り替えを1段で並べる
- **持ち主（コード）**：`apps/web/src/components/shared/list-toolbar.tsx`・`apps/web/src/components/shared/list-toolbar.module.css`・`apps/web/src/components/shared/search-field.tsx`（部品 `ListToolbar`・`ListToolbarSearch`・`ListToolbarOptional`）
  - 読む変数：`--color-control-border`・`--control-shadow`
- **持ち主（Pen）**：`c4n9Kr`「道具の1段」・`TkVyB`「検索」
- **見つけ方（コード）**：
  - toolbar-class：`styles\.(toolbar|toolBar|tools|controlsRow|filterBar|filtersRow|searchRow)\b`（持ち主の部品を読んでいないファイルだけ） — 道具の段を CSS で手書き
  - search-alone：`<SearchField\b`（持ち主の部品を読んでいないファイルだけ） — 検索欄を道具の段の外で置いている
  - sort-alone：`<SortSelect\b`（持ち主の部品を読んでいないファイルだけ） — 並びの欄を道具の段の外で置いている
  - (b) の割り当て：画面の CSS の上書きの selector が `toolbar` に当たればこの型
  - (c) の割り当て：直書きの selector が `toolbar|toolBar|controls\b|filters?Row|searchRow` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - hand-toolbar：名前 `^(道具|道具の段|検索の段|絞り込みの段)$` — 道具の段の手描き（部品「道具の1段」でない）
- **決まり**：[§6.8](v8-design-rules.md)・[§6.11-12](v8-design-rules.md)・B-143・B-122・B-157
- **見張り**：`apps/web/src/components/shared/list-toolbar-contract.test.tsx`・`apps/web/src/components/ui/list-controls-contract.test.ts`
- **10-09 の数**：(a) 227（v8 170）・(b) 1・(c) 9・(d) 手描き 157（153 板）／写し 3・効く範囲 36 ファイル／29 機能／Pen 191 板

<a id="filter"></a>
## filter 絞り込み

- **役目**：一覧を状態・種類などで絞る札。数が増える物は選ぶ窓で絞る
- **持ち主（コード）**：`apps/web/src/components/shared/filter-chip.tsx`・`apps/web/src/components/shared/filter-chip.css`（部品 `FilterChip`）
  - 読む変数：`--color-control-border`
- **持ち主（Pen）**：`XGJDa`「絞り込みの札/オン」・`O2fCAt`「絞り込みの札/オフ」
- **見つけ方（コード）**：
  - growing-select：`<Select\b(?:[^<>]|=>){0,400}?(label|aria-label|placeholder)=["'][^"']*(店舗|タグ|シナリオ|担当者|所属アカウント|送信者|スタッフ|テンプレート)` — 数が増える物の絞り込みをプルダウンで（B-164 は選ぶ窓）
  - own-chip：`aria-pressed=\{`（持ち主の部品を読んでいないファイルだけ） — 絞り込みの札を aria-pressed で自作
  - (b) の割り当て：画面の CSS の上書きの selector が `filter|chip` に当たればこの型
  - (c) の割り当て：直書きの selector が `filter|chip` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - hand-chip：名前 `^(札 すべて|絞り込み|札 絞り込み)`・名前が `絞り込みの札|窓を開く` でない — 絞り込みの札の手描き
- **決まり**：[§6.17](v8-design-rules.md)・B-164・B-163
- **見張り**：`apps/web/src/components/shared/filter-chip.test.tsx`／**要る試験**：道具の段の絞り込みで、作った物（店舗・タグ・シナリオ）を Select で並べたら落ちる試験
- **10-09 の数**：(a) 190（v8 90）・(b) 28・(c) 29・(d) 手描き 37（27 板）／写し 5・効く範囲 116 ファイル／55 機能／Pen 40 板

<a id="folder-column"></a>
## folder-column フォルダの列

- **役目**：一覧の左でフォルダを選び・作り・並べ替える
- **持ち主（コード）**：`apps/web/src/components/shared/managed-folder-panel.tsx`・`apps/web/src/components/shared/managed-folder-panel.module.css`・`apps/web/src/components/shared/folder-panel.tsx`・`apps/web/src/components/shared/folder-panel.module.css`・`apps/web/src/components/shared/folder-row-actions.tsx`・`apps/web/src/components/shared/folder-add-dialog.tsx`・`apps/web/src/components/shared/folder-editor-dialog.tsx`・`apps/web/src/components/shared/folder-dot.tsx`（部品 `ManagedFolderPanel`・`FolderPanel`・`FolderDot`）
  - 読む変数：`--color-hairline`
- **持ち主（Pen）**：`faSbC`「フォルダの列」
  - 部品の板の html に書き出されていない ID：`faSbC`（文書の記録 `~/lh-work/design/v8/review/PEN-UPDATE-1009.md`・`COMPONENT-MAP.md` にある。(d) の写しの比べはできない）
- **見つけ方（コード）**：
  - raw-panel：`<FolderPanel\b`（持ち主の部品を読んでいないファイルだけ） — FolderPanel を直に使う（ManagedFolderPanel にする）
  - row-actions：`\buseFolderRowActions\(` — フォルダの行の「…」を画面で組む
  - own-dialog：`<(FolderAddDialog|FolderEditorDialog)\b` — フォルダの窓を画面で直に出す
  - folder-words：`(?:>|['"'])[^<'"']{0,40}(?:フォルダを追加する|見る：|フォルダを消しても)` — フォルダの列の言葉が決まりと違う
  - (b) の割り当て：画面の CSS の上書きの selector が `folder|rail` に当たればこの型
  - (c) の割り当て：直書きの selector が `folder|rail` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - hand-folders：名前 `^(フォルダ|フォルダの一覧|左の列|見る)$` — フォルダの列の手描き（部品 faSbC でない名前）
- **決まり**：[§2](v8-design-rules.md)・[§6.8](v8-design-rules.md)・B-143・B-136・B-126・B-147
- **見張り**：`apps/web/src/components/shared/folder-panel-contract.test.ts`・`apps/web/src/components/shared/managed-folder-panel.test.tsx`・`apps/web/src/components/shared/folder-rail-owner-contract.test.ts`・`apps/web/src/v8/folder-dot-1152-contract.test.ts`
- **10-09 の数**：(a) 83（v8 60）・(b) 1・(c) 32・(d) 手描き 19（11 板）／写し 0・効く範囲 16 ファイル／13 機能／Pen 0 板

<a id="table"></a>
## table 表

- **役目**：一覧の行を見出し40・行56・左右16・線は黒7%で並べる
- **持ち主（コード）**：`apps/web/src/components/shared/table.tsx`・`apps/web/src/components/shared/table.module.css`・`apps/web/src/components/shared/grid-table.tsx`・`apps/web/src/components/shared/grid-table.module.css`・`apps/web/src/components/shared/data-table.module.css`・`apps/web/src/components/shared/table-presentation.module.css`（部品 `DataTable`・`TableHeadRow`・`Th`・`Tr`・`Td`・`SortTh`・`GridTable`・`GridHeadRow`・`GridRow`・`GridCell`）
  - 読む変数：`--color-table-head`・`--color-hairline`
- **持ち主（Pen）**：`ASVsl`「表の見出し」・`JpOg0`「表の行」・`TBCUY`「横に送れる表」
- **見つけ方（コード）**：
  - raw-table：`<table\b` — 表を素の table で手書き
  - raw-grid：`role=["'](grid|row|columnheader|rowheader)["']` — 表を role で手書き
  - (b) の割り当て：画面の CSS の上書きの selector が `\b(table|thead|tbody|tr|th|td)\b` に当たればこの型
  - (c) の割り当て：直書きの selector が `table|row\b|rows\b|cell|thead|tbody|\bth\b|\btd\b|\btr\b` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - hand-row：名前 `^行 `・style に `height: 5\d px|height: 5\dpx|height: (52|54|56|60|61)px` — 表の行の手描き（部品「表の行」でない）
- **決まり**：[§6.5-3](v8-design-rules.md)・[§6.1](v8-design-rules.md)・B-152・B-160
- **見張り**：`apps/web/src/components/shared/table.test.tsx`・`apps/web/src/components/shared/v8-table-row-line-contract.test.ts`・`apps/web/src/components/shared/table-header-migration-contract.test.ts`
- **10-09 の数**：(a) 546（v8 458）・(b) 581・(c) 204・(d) 手描き 4（2 板）／写し 20・効く範囲 223 ファイル／81 機能／Pen 86 板

<a id="row-menu"></a>
## row-menu 行の右端「…」

- **役目**：行の操作を右端の「…」1つにまとめる
- **持ち主（コード）**：`apps/web/src/components/shared/row-actions.tsx`・`apps/web/src/components/shared/row-actions.module.css`・`apps/web/src/components/shared/action-menu.tsx`・`apps/web/src/components/shared/action-menu.module.css`（部品 `RowMenu`・`MoreAction`・`RowActions`・`RowAction`・`RowQuickAction`）
- **持ち主（Pen）**：`hnuY9`「その他操作メニュー」
  - 部品の板の html に書き出されていない ID：`hnuY9`（文書の記録 `~/lh-work/design/v8/review/PEN-UPDATE-1009.md`・`COMPONENT-MAP.md` にある。(d) の写しの比べはできない）
- **見つけ方（コード）**：
  - own-dots：`>\s*(…|⋯|\.\.\.)\s*<` — 「…」を手で描く
  - dots-icon：`\b(MoreHorizontal|MoreVertical|DotsHorizontal|EllipsisHorizontal|Ellipsis)\b`（持ち主の部品を読んでいないファイルだけ） — 「…」の印を手で置く
  - row-buttons：`styles\.(rowActions|rowButtons|actionsCell|rowOps)\b`（持ち主の部品を読んでいないファイルだけ） — 行の右端にボタンを並べる
  - (b) の割り当て：画面の CSS の上書きの selector が `rowMenu|rowAction|more` に当たればこの型
  - (c) の割り当て：直書きの selector が `rowMenu|rowAction|more\b|kebab|ellipsis|rowButtons?` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - hand-dots：文字 `^(…|⋯)$`・祖先の名前 `^行|表の行` — 「…」の手描き（その他の操作の部品でない）
  - 除く祖先：`^その他の操作`
- **決まり**：[§2](v8-design-rules.md)・[§6.8](v8-design-rules.md)・B-143
- **見張り**：`apps/web/src/components/shared/row-actions-contract.test.tsx`・`apps/web/src/v8/row-menu-contract.test.ts`
- **10-09 の数**：(a) 109（v8 53）・(b) 31・(c) 9・(d) 手描き 0（0 板）／写し 0・効く範囲 132 ファイル／68 機能／Pen 0 板

<a id="pagination"></a>
## pagination ページ送り

- **役目**：ページを送り、10・20・50件を切り替える
- **持ち主（コード）**：`apps/web/src/components/shared/pagination.tsx`・`apps/web/src/components/shared/pagination.module.css`・`apps/web/src/components/ui/page-size-select.tsx`・`apps/web/src/components/ui/list-range.tsx`（部品 `Pagination`・`PageSizeSelect`・`ListPagePagination`）
- **持ち主（Pen）**：`jX2Uw`「ページ送り」
  - 注：PageSizeSelect は components/ui にあり shared に無い（B-143）
- **見つけ方（コード）**：
  - own-size：`\b(const|let)\s+\w*(PAGE_SIZE|PAGE_SIZES|PER_PAGE|pageSizes|perPageOptions)\w*\s*=` — 件数の定数を画面ごとに持つ
  - size-100：`\[\s*20\s*,\s*50\s*,\s*100\s*\]` — 件数が 20・50・100（決まりは 10・20・50）
  - more：`(?:>|['"'])[^<'"']{0,40}(?:もっと読む|さらに読み込む|もっと見る)` — 「もっと読む」（ページ送りにする）
  - prev-next：`(?:>|['"'])[^<'"']{0,40}(?:前へ|次へ)`（持ち主の部品を読んでいないファイルだけ） — 前へ・次へを手で置く
  - (b) の割り当て：画面の CSS の上書きの selector が `pagination|pager` に当たればこの型
  - (c) の割り当て：直書きの selector が `pagination|pager|pageSize|perPage` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - hand-pager：文字 `^(前へ|次へ|もっと読む|‹|›)$` — ページ送りの手描き
  - 除く祖先：`^ページ送り`
- **決まり**：[§2](v8-design-rules.md)・[§6.8](v8-design-rules.md)・B-143
- **見張り**：`apps/web/src/components/ui/list-range-contract.test.ts`／**要る試験**：ページ送りのある一覧で件数の切り替え（10・20・50）が無い・定数を画面で持つと落ちる試験
- **10-09 の数**：(a) 222（v8 126）・(b) 0・(c) 12・(d) 手描き 8（6 板）／写し 0・効く範囲 155 ファイル／71 機能／Pen 56 板

<a id="detail-panel"></a>
## detail-panel 詳細のパネル・引き出し

- **役目**：行の詳細は右の DetailPanel 360、編集は Drawer 480/540
- **持ち主（コード）**：`apps/web/src/components/shared/detail-panel.tsx`・`apps/web/src/components/shared/detail-panel.module.css`・`apps/web/src/components/shared/drawer.tsx`・`apps/web/src/components/shared/drawer.module.css`・`apps/web/src/components/shared/slide-panel.tsx`（部品 `DetailPanel`・`Drawer`）
  - 読む変数：`--radius-panel`・`--shadow-float`
- **持ち主（Pen）**：**未定**
  - 注：Pen の部品 ID が対応表に無い（ZBjxY の「引き出し」は板の中の名前だけ）
- **見つけ方（コード）**：
  - fixed-right：CSS の規則に `position:\s*fixed` と `right:\s*0` と `width:\s*\d{3}px|width:\s*min\(` があり — 右から出るパネルを CSS で手書き
  - aside：`<aside\b`（持ち主の部品を読んでいないファイルだけ） — 右のパネルを aside で手書き
  - (b) の割り当て：画面の CSS の上書きの selector が `drawer|detailPanel` に当たればこの型
  - (c) の割り当て：直書きの selector が `drawer|panel|aside|sidePane|sheet` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - odd-width：名前 `引き出し|詳細パネル|右の欄`・style に `width: \d+px`・style に `width: (360|480|540|320|1160)px` が無い — 段にない幅のパネル（360・480・540・320・1160 以外）
- **決まり**：[§6.12-8](v8-design-rules.md)・B-158・B-160
- **見張り**：`apps/web/src/components/shared/detail-panel.test.tsx`／**要る試験**：Drawer の幅が 480/540 以外・手書きの固定パネルで落ちる試験
- **10-09 の数**：(a) 140（v8 73）・(b) 3・(c) 14・(d) 手描き 13（9 板）／写し 0・効く範囲 41 ファイル／29 機能／Pen 0 板

<a id="dialog"></a>
## dialog 窓（確かめ・編集）

- **役目**：確かめ・編集・選ぶを、頭・本文・下の帯を線で分けた窓で出す
- **持ち主（コード）**：`apps/web/src/components/shared/dialog.tsx`・`apps/web/src/components/shared/dialog.module.css`・`apps/web/src/components/shared/confirm-dialog.tsx`・`apps/web/src/components/shared/overlay-utils.ts`（部品 `Dialog`・`ConfirmDialog`・`DialogSteps`）
  - 読む変数：`--radius-panel`・`--shadow-float`・`--card-edge`
- **持ち主（Pen）**：`q3DPdz`「ダイアログ/中」
- **見つけ方（コード）**：
  - raw-dialog：`role=["']dialog["']|aria-modal=|<dialog\b` — 窓を手書き
  - confirm：`\bwindow\.confirm\(|(?<![\w.])confirm\(\s*['"']` — ブラウザの confirm
  - half-q：`title=["'][^"']*\?["']` — 窓の題の「?」が半角（B-146 の 6）
  - (b) の割り当て：画面の CSS の上書きの selector が `dialog|modal|\[role=.?dialog|::backdrop` に当たればこの型
  - (c) の割り当て：直書きの selector が `dialog|modal|overlay|backdrop` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - hand-dialog：名前 `(の窓|窓$|小窓)`・名前が `選ぶ窓|窓を開く|窓で選ぶ` でない・style に `border-radius: 16px` — 窓の手描き（部品「ダイアログ/中」でない）
- **決まり**：[§5](v8-design-rules.md)・[§6.8](v8-design-rules.md)・[§6.12-8](v8-design-rules.md)・B-145・B-146
- **見張り**：`apps/web/src/components/shared/dialog-design-size-contract.test.tsx`・`apps/web/src/components/shared/confirm-dialog-design-size.test.tsx`・`apps/web/src/components/shared/dialog-design-header.react.test.tsx`／**要る試験**：窓の題の終わりが半角「?」・記号なしで落ちる試験
- **10-09 の数**：(a) 109（v8 32）・(b) 18・(c) 41・(d) 手描き 6（6 板）／写し 0・効く範囲 354 ファイル／109 機能／Pen 0 板

<a id="picker-dialog"></a>
## picker-dialog 選ぶ窓

- **役目**：作ってある物を、フォルダ・探す・見本付きの窓で選ぶ（受信箱の「テンプレートを選ぶ」の形1つ）
- **持ち主（コード）**：`apps/web/src/components/shared/entity-picker.tsx`・`apps/web/src/components/shared/entity-picker.module.css`・`apps/web/src/components/shared/entity-picker-sources.tsx`・`apps/web/src/components/shared/hq-account-picker.tsx`（部品 `EntityPickerDialog`・`EntityMultiPickerDialog`・`HqAccountPickerDialog`）
- **持ち主（Pen）**：`S2Vgi`「選ぶ窓（正の形・B-165）」・`A1eZS`「選ぶ窓（V8-B の写し）」
  - 部品の板の html に書き出されていない ID：`S2Vgi`・`A1eZS`（文書の記録 `~/lh-work/design/v8/review/PEN-UPDATE-1009.md`・`COMPONENT-MAP.md` にある。(d) の写しの比べはできない）
- **見つけ方（コード）**：
  - old-picker：`<(SourcePickerDialog|SelectionDialog)\b` — 古い選ぶ窓（EntityPickerDialog にする）
  - own-picker：`\b(function|const)\s+\w*(Picker|Chooser|Selector)(Dialog|Modal)\b` — 画面で選ぶ窓を自作
  - (b) の割り当て：画面の CSS の上書きの selector が `picker` に当たればこの型
  - (c) の割り当て：直書きの selector が `picker|chooser` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - old-window：名前 `選ぶ窓|を選ぶ窓|1つ選ぶ窓`・名前が `B-165|^10\. 選ぶ窓` でない — 正の形でない選ぶ窓（dJZ7Q など古い窓）
- **決まり**：[§6.10](v8-design-rules.md)・[§6.17](v8-design-rules.md)・B-155・B-163・B-165・B-133
- **見張り**：`apps/web/src/components/shared/entity-picker.test.tsx`・`apps/web/src/components/shared/select-window-react.test.tsx`／**要る試験**：選ぶ窓を SourcePickerDialog・自作の窓で出すと落ちる試験
- **10-09 の数**：(a) 2（v8 1）・(b) 1・(c) 1・(d) 手描き 3（3 板）／写し 0・効く範囲 2 ファイル／1 機能／Pen 0 板

<a id="picker-field"></a>
## picker-field 選ぶ欄（選ぶ前・選んだ後）

- **役目**：選ぶ前は「〇〇を選ぶ」の副ボタン、選んだ後は見本・札＋「変える」
- **持ち主（コード）**：`apps/web/src/components/shared/entity-picker.tsx`（部品 `EntityPickerSummary`・`EntityPickerField`・`HqAccountPickerField`・`HqAccountSelectField`）
- **持ち主（Pen）**：**未定**
  - 注：Pen の欄の部品 ID が無い（決まりの板 MqqcW・aXUuh は見本。板では「選んだもの（B-163 窓で選ぶ）」の名前）
- **見つけ方（コード）**：
  - select-entity：`<(Select|Combobox|MultiSelect)\b(?:[^<>]|=>){0,500}?(label|aria-label|placeholder)=["'][^"']*(テンプレート|回答フォーム|タグ|シナリオ|リッチメニュー|予約メニュー|クーポン|スタンプカード|スタッフ|セグメント|アカウント|店舗|友だち情報)` — 作ってある物をプルダウンで選ばせる（B-155・B-163）
  - multi-select：`<(MultiSelect|EntityMultiSelect)\b` — 下に広がる複数選び（B-163 は窓）
  - (c) の割り当て：直書きの selector が `pickerField|picked|chosen` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - dropdown-entity：名前 `^欄 (テンプレート|回答フォーム|タグ|シナリオ|リッチメニュー|予約メニュー|クーポン|スタッフ|店舗|アカウント)` — 作ってある物を選ぶ欄がプルダウンの形
- **決まり**：[§2](v8-design-rules.md)・[§6.10](v8-design-rules.md)・[§6.17](v8-design-rules.md)・B-155・B-163
- **見張り**：`apps/web/src/components/shared/entity-picker.test.tsx`／**要る試験**：作ってある物（テンプレート・タグ…）の label の Select が出たら落ちる試験
- **10-09 の数**：(a) 137（v8 71）・(b) 0・(c) 2・(d) 手描き 64（19 板）／写し 0・効く範囲 7 ファイル／4 機能／Pen 0 板

<a id="select"></a>
## select プルダウン（許される範囲）

- **役目**：数が決まっていて少ない選択（種類・並び・期間・件数・役割など7個まで）だけ
- **持ち主（コード）**：`apps/web/src/components/shared/select.tsx`・`apps/web/src/components/shared/select.module.css`・`apps/web/src/components/shared/select-menu.tsx`・`apps/web/src/components/shared/select-menu.module.css`・`apps/web/src/components/shared/menu-portal.tsx`（部品 `Select`・`SelectMenu`）
  - 読む変数：`--color-control-border`・`--radius-control`
- **持ち主（Pen）**：`wMMk6`「選ぶ欄」・`StFE7`「選ぶ欄/開いた」
  - 部品の板の html に書き出されていない ID：`StFE7`（文書の記録 `~/lh-work/design/v8/review/PEN-UPDATE-1009.md`・`COMPONENT-MAP.md` にある。(d) の写しの比べはできない）
- **見つけ方（コード）**：
  - raw-select：`<select\b` — 素の select
  - own-listbox：`role=["'](listbox|option|menu|menuitem)["']` — 開いた一覧を手書き
  - head-prefix：`label:\s*['"'](並び|フォルダ|状態)：` — 選択肢に「並び：」などの頭（B-45）
  - (b) の割り当て：画面の CSS の上書きの selector が `select|dropdown|listbox` に当たればこの型
  - (c) の割り当て：直書きの selector が `select|dropdown|listbox|menuList` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - hand-open：名前 `^(開いた|メニュー|選択肢の一覧|候補)$` — 開いた中身の手描き（StFE7 でない）
- **決まり**：[§2](v8-design-rules.md)・[§6.17](v8-design-rules.md)・B-45・B-163
- **見張り**：`apps/web/src/components/shared/select-menu.react.test.tsx`・`apps/web/src/components/shared/select-width-text.test.tsx`・`apps/web/src/components/shared/menu-portal-rollout-contract.test.ts`
- **10-09 の数**：(a) 154（v8 88）・(b) 33・(c) 18・(d) 手描き 12（8 板）／写し 3・効く範囲 376 ファイル／111 機能／Pen 97 板

<a id="tap-action"></a>
## tap-action 押したら（TapActionField）

- **役目**：ボタン・面を押したときの動き（URL・テキスト・予約・回答フォーム・予約履歴・来店スタンプ）を選ぶ
- **持ち主（コード）**：`apps/web/src/components/shared/tap-action-field.tsx`・`apps/web/src/components/shared/tap-action-field.module.css`・`apps/web/src/lib/tap-actions.ts`・`apps/web/src/components/shared/use-tap-action-sources.ts`（部品 `TapActionField`・`TapTargetPicker`）
- **持ち主（Pen）**：`Vx8Ny`「押したら（TapActionField）/閉じた」・`XVGg5`「押したら/開いた」・`c1qBx`「押したら/選んだ後」
  - 部品の板の html に書き出されていない ID：`Vx8Ny`・`XVGg5`・`c1qBx`（文書の記録 `~/lh-work/design/v8/review/PEN-UPDATE-1009.md`・`COMPONENT-MAP.md` にある。(d) の写しの比べはできない）
- **見つけ方（コード）**：
  - old-uri：`<UriTapActionField\b` — 古い押したらの欄
  - own-types：`['"](uri|postback|message|datetimepicker)['"]\s*[,:]`（持ち主の部品を読んでいないファイルだけ）（ファイル `\.tsx$`） — 押したらの種類を画面で並べる
  - own-label：`(?:>|['"'])[^<'"']{0,40}(?:押したときの動き|タップしたとき|押したら)`（持ち主の部品を読んでいないファイルだけ） — 押したらの欄を画面で組む
  - (b) の割り当て：画面の CSS の上書きの selector が `tapAction` に当たればこの型
  - (c) の割り当て：直書きの selector が `tapAction|actionType|tapType` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - hand-tap：名前 `^(欄 )?(押したら|押した時の動き|ボタンの動き)$` — 押したらの欄の手描き
- **決まり**：[§6.13](v8-design-rules.md)・B-129・B-135
- **見張り**：`apps/web/src/components/shared/tap-action-field.test.tsx`・`apps/web/src/lib/tap-actions.test.ts`
- **10-09 の数**：(a) 44（v8 29）・(b) 0・(c) 1・(d) 手描き 0（0 板）／写し 0・効く範囲 6 ファイル／6 機能／Pen 0 板

<a id="tap-extra"></a>
## tap-extra 押されたときにあわせて行うこと

- **役目**：押したらに付けて、タグを付ける・スコアを足す
- **持ち主（コード）**：`apps/web/src/components/shared/tap-action-field.tsx`（部品 `TapActionField`）
- **持ち主（Pen）**：`A2gkiG`「あわせて行うこと/閉じた」・`TPuCf`「あわせて行うこと/開いた」・`b2hVaX`「あわせて行うこと/選んだ後」
  - 部品の板の html に書き出されていない ID：`A2gkiG`・`TPuCf`・`b2hVaX`（文書の記録 `~/lh-work/design/v8/review/PEN-UPDATE-1009.md`・`COMPONENT-MAP.md` にある。(d) の写しの比べはできない）
- **見つけ方（コード）**：
  - own-extra：`(?:>|['"'])[^<'"']{0,40}(?:タグを付ける|スコアを足す|スコアを加算|タグを追加する)`（持ち主の部品を読んでいないファイルだけ） — あわせて行うことを画面で組む
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - hand-extra：名前 `押した人に|タグを付ける行` — あわせて行うことの手描き
- **決まり**：[§6.17](v8-design-rules.md)・B-162・B-164
- **見張り**：`apps/web/src/components/shared/tap-action-field.test.tsx`
- **10-09 の数**：(a) 48（v8 27）・(b) 0・(c) 0・(d) 手描き 0（0 板）／写し 0・効く範囲 6 ファイル／6 機能／Pen 0 板

<a id="action-list"></a>
## action-list 行うことを足す

- **役目**：［＋ 行うことを足す］→種類→選ぶ窓→行で並べる（回答フォーム・カルーセル・質問・自動応答・友だち追加・リッチメニュー）
- **持ち主（コード）**：**未実装**
- **持ち主（Pen）**：**未定**
  - 注：未実装（B-169）。コードの部品も Pen の部品も無い。作ってから持ち主を書く
- **見つけ方（コード）**：
  - words：`(?:>|['"'])[^<'"']{0,40}(?:行うことを足す|行うことを追加|アクションを追加|答え終わったら|回答したときに付けるタグ|使われたときに行うこと|答え終わったときに行うこと)` — 「行うこと」を画面ごとに組んでいる
  - (c) の割り当て：直書きの selector が `actions?List|actionRow|addAction` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - hand-actions：名前 `行うこと`・名前が `押されたときに、あわせて行うこと` でない — 行うことの段の手描き（部品が無い）
- **決まり**：[§6.19](v8-design-rules.md)・B-169
- **見張り**：なし／**要る試験**：共通部品を作ったら：回答フォーム・カルーセル・質問・自動応答・友だち追加・リッチメニューがその部品を読む試験
- **10-09 の数**：(a) 34（v8 16）・(b) 0・(c) 8・(d) 手描き 24（16 板）／写し 0・効く範囲 0 ファイル／0 機能／Pen 0 板

<a id="media-slot"></a>
## media-slot 画像の枠（MediaSlot）

- **役目**：画像・動画・音声・ファイルを入れる所（真ん中に印・題「〇〇を追加」・ドラッグ・制限の文）
- **持ち主（コード）**：`apps/web/src/components/shared/media-slot.tsx`・`apps/web/src/components/shared/media-slot.module.css`・`apps/web/src/components/shared/media-picker-dialog.tsx`・`apps/web/src/components/shared/media-library-upload.ts`（部品 `MediaSlot`・`MediaPickerDialog`）
- **持ち主（Pen）**：**未定**
  - 注：Pen の部品 ID が無い（Z7vd2 は見本で消した。板では「画像を追加 空・小・入った」の名前）
- **見つけ方（コード）**：
  - file-input：`type=["']file["']` — 手書きの file 入力
  - old-upload：`<(ImageUploader|FileDropzone)\b` — 古い取り込み部品
  - limit-text：`(?:>|['"'])[^<'"']{0,40}(?:MB\s*(以内|以下|まで)|JPG|jpg\/)`（持ち主の部品を読んでいないファイルだけ） — 上限の文を画面で書く
  - dashed：CSS の規則に `border(-style)?:[^;]*dashed` があり — 点線の箱
  - (b) の割り当て：画面の CSS の上書きの selector が `media|upload|drop` に当たればこの型
  - (c) の割り当て：直書きの selector が `upload|dropzone|drop\b|media|thumb|imageBox` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - dashed-box：style に `dashed` — 点線の古い箱
- **決まり**：[§6.12-9](v8-design-rules.md)・[§6.13](v8-design-rules.md)・B-128・B-138・B-161
- **見張り**：`apps/web/src/components/shared/media-slot.test.tsx`／**要る試験**：type="file" を共通部品の外で書いたら落ちる試験
- **10-09 の数**：(a) 81（v8 41）・(b) 1・(c) 11・(d) 手描き 0（0 板）／写し 0・効く範囲 26 ファイル／16 機能／Pen 0 板

<a id="field"></a>
## field 欄（Field・必須・任意・文字数）

- **役目**：ラベル・必須/任意の札・文字数・補足 note を1つの形で出す
- **持ち主（コード）**：`apps/web/src/components/shared/form-controls.tsx`・`apps/web/src/components/shared/form-controls.module.css`・`apps/web/src/components/shared/text-field.tsx`・`apps/web/src/components/shared/text-field.module.css`・`apps/web/src/components/shared/field-context.ts`（部品 `Field`・`TextInput`・`TextArea`・`RequiredBadge`・`OptionalBadge`・`TextField`）
  - 読む変数：`--color-control-border`・`--radius-control`
- **持ち主（Pen）**：`Ume2U`「入力欄」・`i5BW8b`「入力欄/複数行」
  - 部品の板の html に書き出されていない ID：`i5BW8b`（文書の記録 `~/lh-work/design/v8/review/PEN-UPDATE-1009.md`・`COMPONENT-MAP.md` にある。(d) の写しの比べはできない）
- **見つけ方（コード）**：
  - optional-paren：`（任意）|\(任意\)` — 「（任意）」（札にする）
  - asterisk：`>\s*[＊*]\s*<` — 必須の「＊」
  - own-count：`\.length\s*\}?\s*\/\s*\{?\s*\w*(MAX|max|limit|Limit|\d+)`（ファイル `\.tsx$`） — 文字数を画面で数えて出す
  - half-ex：`['">]例:\s?` — 入力例が半角「例:」
  - raw-label：`<label\b(?![^>]*className=\{styles\.(check|radio|toggle))`（持ち主の部品を読んでいないファイルだけ） — ラベルを手書き
  - (b) の割り当て：画面の CSS の上書きの selector が `\b(input|textarea|label)\b|field` に当たればこの型
  - (c) の割り当て：直書きの selector が `field|label|input|textarea|formRow|control\b` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - paren-optional：文字 `（任意）` — 「（任意）」の文字（札でない）
- **決まり**：[§6.12-4](v8-design-rules.md)・[§6.12-16](v8-design-rules.md)・B-158
- **見張り**：`apps/web/src/components/shared/optional-badge.test.tsx`・`apps/web/src/components/shared/text-field-unified.react.test.tsx`／**要る試験**：「（任意）」「＊」を書いたら落ちる試験
- **10-09 の数**：(a) 804（v8 332）・(b) 52・(c) 196・(d) 手描き 1（1 板）／写し 4・効く範囲 269 ファイル／91 機能／Pen 104 板

<a id="field-error"></a>
## field-error 欄の赤表示

- **役目**：誤りの欄を赤く・下に理由・最初の誤りへ移る。欄に結び付かない失敗だけ Notice danger
- **持ち主（コード）**：`apps/web/src/lib/use-form-errors.ts`・`apps/web/src/components/shared/validation-summary.tsx`・`apps/web/src/components/shared/error-count-badge.tsx`・`apps/web/src/components/shared/form-controls.tsx`（部品 `useFormErrors`・`FieldError`・`ValidationSummary`・`ErrorCountBadge`）
  - 読む変数：`--color-danger`
- **持ち主（Pen）**：`fDAyI`「入力欄/エラー」
  - 部品の板の html に書き出されていない ID：`fDAyI`（文書の記録 `~/lh-work/design/v8/review/PEN-UPDATE-1009.md`・`COMPONENT-MAP.md` にある。(d) の写しの比べはできない）
- **見つけ方（コード）**：
  - raw-alert：`role=["']alert["']` — 手書きの role="alert"
  - own-invalid：`aria-invalid=\{`（持ち主の部品を読んでいないファイルだけ） — 欄の誤りを画面で組む
  - (b) の割り当て：画面の CSS の上書きの selector が `error|invalid` に当たればこの型
  - (c) の割り当て：直書きの selector が `error|invalid|alert` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - red-band-only：名前 `^帯 (エラー|誤り|失敗)` — 上の赤い帯だけの誤り
- **決まり**：[§6.9](v8-design-rules.md)・B-154・B-139
- **見張り**：`apps/web/src/lib/use-form-errors.test.tsx`・`apps/web/src/components/shared/field-errors-controls.react.test.tsx`／**要る試験**：作る・編集の画面が useFormErrors を読まないと落ちる試験
- **10-09 の数**：(a) 704（v8 477）・(b) 14・(c) 31・(d) 手描き 0（0 板）／写し 0・効く範囲 43 ファイル／27 機能／Pen 0 板

<a id="sticky-bar"></a>
## sticky-bar 作る・編集の下の帯

- **役目**：画面の下に追従。キャンセル・保存は中央、削除は左端
- **持ち主（コード）**：`apps/web/src/components/shared/sticky-bar.tsx`・`apps/web/src/components/shared/sticky-bar.module.css`・`apps/web/src/components/templates/create-page.tsx`・`apps/web/src/components/shared/create-page.tsx`（部品 `StickyBar`・`CreatePage`・`PageFooter`）
  - 読む変数：`--shadow-bar-float`
- **持ち主（Pen）**：**未定**
  - 注：Pen の部品 ID が無い（板では「下の帯（追従・常に画面の下）」の名前）
- **見つけ方（コード）**：
  - sticky-bottom：CSS の規則に `position:\s*(sticky|fixed)` と `bottom:\s*0` があり — 下の帯を CSS で手書き
  - back-in-bar：`(?:>|['"'])[^<'"']{0,40}(?:一覧へ戻る|一覧に戻る)` — 帯に「一覧へ戻る」
  - (b) の割り当て：画面の CSS の上書きの selector が `footer|sticky|bottomBar` に当たればこの型
  - (c) の割り当て：直書きの selector が `footer|bottomBar|stickyBar|actionBar|saveBar` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - fixed-bar：名前 `^下の帯（固定）$` — 「固定」の下の帯（追従でない名前）
- **決まり**：[§2](v8-design-rules.md)・[§6.8](v8-design-rules.md)・B-143
- **見張り**：`apps/web/src/components/shared/sticky-bar-contract.test.ts`・`apps/web/src/components/templates/create-page-spacing.test.tsx`／**要る試験**：帯に「一覧へ戻る」・削除が左端でない形で落ちる試験
- **10-09 の数**：(a) 260（v8 162）・(b) 5・(c) 15・(d) 手描き 30（30 板）／写し 0・効く範囲 126 ファイル／72 機能／Pen 0 板

<a id="tabs"></a>
## tabs タブ

- **役目**：中身を切り替える。?tab= と router.replace
- **持ち主（コード）**：`apps/web/src/components/shared/tabs.tsx`・`apps/web/src/components/shared/tabs.module.css`・`apps/web/src/components/layout/scrollable-tabs.tsx`・`apps/web/src/components/layout/merged-tabs.tsx`（部品 `Tabs`・`ScrollableTabs`・`MergedTabs`）
- **持ち主（Pen）**：`clV5c`「タブ」
- **見つけ方（コード）**：
  - raw-tab：`role=["'](tab|tablist)["']` — タブを手書き
  - push-tab：`router\.push\([^)]*tab=` — タブで履歴を積む（replace にする）
  - (b) の割り当て：画面の CSS の上書きの selector が `tab|\[role=.?tab` に当たればこの型
  - (c) の割り当て：直書きの selector が `tab\b|tabs\b|tabList|tabBar` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - hand-tab：名前 `^(タブの段|種類のタブ)$` — タブの段の手描き
- **決まり**：[§5](v8-design-rules.md)・[§6.12-3](v8-design-rules.md)・B-158
- **見張り**：`apps/web/src/components/shared/tabs-height-contract.test.ts`・`apps/web/src/components/shared/tabs-v8-indicator.react.test.tsx`・`apps/web/src/components/layout/scrollable-tabs-contract.test.ts`／**要る試験**：role="tab" を共通部品の外で書いたら落ちる試験
- **10-09 の数**：(a) 86（v8 52）・(b) 19・(c) 13・(d) 手描き 130（108 板）／写し 13・効く範囲 80 ファイル／51 機能／Pen 132 板

<a id="status-badge"></a>
## status-badge 状態の札

- **役目**：丸い札・12/600・左に6pxの丸・5色。言葉は状態の表から
- **持ち主（コード）**：`apps/web/src/components/shared/status-badge.tsx`・`apps/web/src/components/shared/status-badge.module.css`（部品 `StatusBadge`）
  - 読む変数：`--radius-pill`・`--color-success`・`--color-danger`・`--color-warning`・`--color-info`
- **持ち主（Pen）**：`mpVfY`「状態の札/送信済み・対応済み」・`ekmYd`「状態の札/予約中・案内」・`ii85L`「状態の札/対応中・注意」・`XwfSH`「状態の札/未対応・失敗」・`hQeAo`「状態の札/下書き・停止」
  - 注：状態の言葉の表は未実装（B-158 の 1）
- **見つけ方（コード）**：
  - own-badge：`\b(function|const)\s+\w*(StatusBadge|StatusPill|StatePill|StateBadge|Pill|Badge)\b\s*[=(]` — 状態の札を自作
  - old-pill：`<(StatusPill|StatusChip)\b` — 別の札の部品
  - words：`(?:>|['"'])[^<'"']{0,40}(?:稼働中|一時停止|保管|アーカイブ済み|予約済み|送信完了)` — 使わない状態の言葉（B-158 の 1）
  - (b) の割り当て：画面の CSS の上書きの selector が `badge|pill|status|\[data-tone` に当たればこの型
  - (c) の割り当て：直書きの selector が `badge|pill|status|state(Tag|Label)?\b` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - hand-badge：名前 `^札 (有効|公開中|下書き|停止中|予約中|送信済み|失敗|注意)` — 状態の札の手描き（「状態の札/…」の部品でない）
- **決まり**：[§6.5-4](v8-design-rules.md)・[§6.12-1](v8-design-rules.md)・B-152・B-158・B-160
- **見張り**：`apps/web/src/components/shared/status-chip.test.tsx`／**要る試験**：StatusBadge を自作・別の札で状態を出すと落ちる試験
- **10-09 の数**：(a) 436（v8 268）・(b) 81・(c) 54・(d) 手描き 306（65 板）／写し 10・効く範囲 125 ファイル／56 機能／Pen 178 板

<a id="list-state"></a>
## list-state 空・読めない・読み込み中

- **役目**：空・絞り込みで0件・読めなかった（もう一度読み込む）・骨組みを1つの形で出す
- **持ち主（コード）**：`apps/web/src/components/shared/list-state.tsx`・`apps/web/src/components/shared/list-state.module.css`・`apps/web/src/components/shared/skeleton.tsx`・`apps/web/src/components/shared/skeleton.module.css`・`apps/web/src/components/shared/empty-list.tsx`・`apps/web/src/components/shared/retry-label.tsx`（部品 `ListState`・`TableSkeleton`・`CardsSkeleton`・`Skeleton`・`DelayedSkeleton`・`EmptyList`）
  - 読む変数：`--radius-mini`
- **持ち主（Pen）**：`hNXm7`「空の表示」・`jr5Nl`「骨格の行」・`Dr8Wr`「状態/検索結果0件」・`deztM`「状態/取得失敗」・`q0z77i`「状態/読み込み中」
  - 部品の板の html に書き出されていない ID：`Dr8Wr`・`deztM`・`q0z77i`（文書の記録 `~/lh-work/design/v8/review/PEN-UPDATE-1009.md`・`COMPONENT-MAP.md` にある。(d) の写しの比べはできない）
- **見つけ方（コード）**：
  - state-card：`styles\.(stateCard|emptyState|empty|loading|errorState)\b` — 空・読めない表示を CSS で手書き
  - own-state：`\b(function|const)\s+(StateCard|PageState|EmptyState|LoadingState|ErrorState)\b` — 状態の部品を自作
  - retry-words：`(?:>|['"'])[^<'"']{0,40}(?:再読み込み|再試行|もう一度試す|リトライ)` — 押し口の言葉が「もう一度読み込む」でない
  - spinner：`animate-spin|<Spinner\b` — 回る印（保存中のボタンの中だけ）
  - account-words：`(?:>|['"'])[^<'"']{0,40}(?:アカウントを選択してください|アカウントを選んでください)` — アカウント未選択の言葉（「LINE公式アカウントを選んでください」）
  - (b) の割り当て：画面の CSS の上書きの selector が `empty|skeleton|state` に当たればこの型
  - (c) の割り当て：直書きの selector が `empty|stateCard|loading|skeleton|placeholder|error(State|Card)` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - hand-empty：名前 `^(空|空の表示（まだ1件も無い）|まだ無い)$` — 空の表示の手描き
- **決まり**：[§6.5-8](v8-design-rules.md)・[§6.6-8](v8-design-rules.md)・[§6.11-11](v8-design-rules.md)・[§6.12-18](v8-design-rules.md)・B-143・B-157
- **見張り**：`apps/web/src/components/shared/list-state-contract.test.tsx`・`apps/web/src/components/shared/list-state-retry-contract.test.tsx`・`apps/web/src/components/shared/skeleton-contract.test.tsx`
- **10-09 の数**：(a) 816（v8 475）・(b) 13・(c) 17・(d) 手描き 31（27 板）／写し 0・効く範囲 430 ファイル／115 機能／Pen 1 板

<a id="viewer-band"></a>
## viewer-band 閲覧のみの帯

- **役目**：閲覧のみの人に「閲覧のみで見ています。…」の帯を出す（型に readOnly）
- **持ち主（コード）**：**未実装**
- **持ち主（Pen）**：**未定**
  - 注：未実装（共通部品を作る。今は画面ごとの ViewerBand など。B-143）
- **見つけ方（コード）**：
  - own-band：`\b(ViewerBand|ReadOnlyBand|viewerBand|roBand|readonlyBand|readOnlyBand)\b` — 閲覧のみの帯を画面ごとに作る
  - words：`閲覧のみで(見て|ご覧)` — 閲覧のみの文を画面で書く
  - (c) の割り当て：直書きの selector が `viewer|readOnly|readonly|roBand` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - other-words：文字 `閲覧のみ`・文字が `^閲覧のみで見ています。変える操作は(オーナーか管理者|統括の管理者)に頼んでください。$|^閲覧のみ$` でない — 閲覧のみの帯の文が決まりと違う
- **決まり**：[§2](v8-design-rules.md)・[§6.6-7](v8-design-rules.md)・[§6.8](v8-design-rules.md)・B-146・B-159
- **見張り**：`apps/web/src/v8/viewer-hides-actions.test.ts`／**要る試験**：共通部品を作ったら：閲覧のみの文を画面で書くと落ちる試験
- **10-09 の数**：(a) 248（v8 239）・(b) 0・(c) 10・(d) 手描き 8（7 板）／写し 0・効く範囲 0 ファイル／0 機能／Pen 0 板

<a id="notice"></a>
## notice 知らせ（トースト・Notice）

- **役目**：保存できた＝トースト1つ。失敗は欄の赤か帯。種類は info・success・warn・danger
- **持ち主（コード）**：`apps/web/src/components/shared/toast.tsx`・`apps/web/src/components/shared/toast.module.css`・`apps/web/src/components/shared/notice.tsx`・`apps/web/src/components/shared/notice.module.css`（部品 `Notice`・`notifyToast`・`Toast`）
- **持ち主（Pen）**：`Q6cQB`「知らせ/うまくいった」・`tnWX9`「知らせ/できなかった」・`ThDed`「帯/案内」
- **見つけ方（コード）**：
  - tone-error：`tone=["']error["']` — tone="error"（danger にする）
  - undo：`(?:>|['"'])[^<'"']{0,40}(?:元に戻す)` — 知らせの「元に戻す」（B-160 の 1）
  - alert：`(?<![\w.])alert\(` — ブラウザの alert
  - note-bar：`<NoteBar\b` — 別の帯の部品
  - (b) の割り当て：画面の CSS の上書きの selector が `notice|toast` に当たればこの型
  - (c) の割り当て：直書きの selector が `notice|toast|banner|alertBox|message(Box|Bar)` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - hand-toast：名前 `^知らせ$` — 知らせの手描き（部品の知らせでない）
- **決まり**：[§6.11-6](v8-design-rules.md)・[§6.12-20](v8-design-rules.md)・[§6.15-1](v8-design-rules.md)・B-157・B-158・B-160
- **見張り**：`apps/web/src/components/shared/toast.test.tsx`・`apps/web/src/components/shared/notice-info-contract.test.ts`・`apps/web/src/components/shared/toast-stack.regression.test.tsx`
- **10-09 の数**：(a) 195（v8 62）・(b) 0・(c) 20・(d) 手描き 23（23 板）／写し 0・効く範囲 394 ファイル／112 機能／Pen 23 板

<a id="save-conflict"></a>
## save-conflict ぶつかりの帯

- **役目**：ほかの人が先に保存したとき、入力を残して比べる・最新を読み込む
- **持ち主（コード）**：`apps/web/src/components/shared/save-conflict.tsx`・`apps/web/src/components/shared/save-conflict.module.css`（部品 `useSaveConflict`・`SaveConflictBand`・`SaveConflictCompareDialog`）
- **持ち主（Pen）**：**未定**
  - 注：Pen の部品 ID が無い（見本「ぶつかりの帯」は型の見本 aHrwg の中）
- **見つけ方（コード）**：
  - own-409：`status\s*===?\s*409[\s\S]{0,300}?(conflict|Conflict|競合|revision|Revision|version|更新され|先に保存|ほかの人)`（持ち主の部品を読んでいないファイルだけ） — 保存のぶつかり（409）を画面で扱う
  - old-bar：`<SaveConflictBar\b` — 古いぶつかりの帯
  - words：`(?:>|['"'])[^<'"']{0,40}(?:ほかの人が|他の人が|別の人が|他のユーザー)`（持ち主の部品を読んでいないファイルだけ） — ぶつかりの文を画面で書く
  - (b) の割り当て：画面の CSS の上書きの selector が `conflict` に当たればこの型
  - (c) の割り当て：直書きの selector が `conflict` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - hand-conflict：文字 `ほかの人が先に|他の人が` — ぶつかりの帯の手描き
- **決まり**：[§6.11-9](v8-design-rules.md)・B-157
- **見張り**：`apps/web/src/components/shared/save-conflict-wiring-contract.test.ts`・`apps/web/src/components/shared/save-conflict.react.test.tsx`
- **10-09 の数**：(a) 223（v8 131）・(b) 2・(c) 8・(d) 手描き 0（0 板）／写し 0・効く範囲 12 ファイル／11 機能／Pen 0 板

<a id="customer-info"></a>
## customer-info 顧客情報の欄

- **役目**：受信箱の右の欄と友だちの詳細の概要の左を同じ部品で（段ごとの見出し＋編集する・決まった7つの欄・タグ・マイル…）
- **持ち主（コード）**：**未実装**
- **持ち主（Pen）**：`GBTyR`「顧客情報の欄（B-167）」
  - 注：コードは未実装（受信箱 v8/inbox-chat/customer-panel と友だちの詳細 v8/friend-detail/overview-tab が別々）
  - 部品の板の html に書き出されていない ID：`GBTyR`（文書の記録 `~/lh-work/design/v8/review/PEN-UPDATE-1009.md`・`COMPONENT-MAP.md` にある。(d) の写しの比べはできない）
- **見つけ方（コード）**：
  - two-panels：`\b(CustomerPanel|FriendInfoSidebar|OverviewTab|customerPanel|friendInfo)\b` — 顧客情報の欄を画面ごとに作る
  - words：`(?:>|['"'])[^<'"']{0,40}(?:顧客情報をすべて表示|表示項目)` — 顧客情報の欄の組み立て
  - (c) の割り当て：直書きの selector が `customer|friendInfo|profile(Panel|Card)` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - hand-customer：名前 `顧客(情報|カルテ)|右の列|概要の左`・名前が `B-167` でない — 顧客情報の欄の手描き（GBTyR でない）
- **決まり**：B-167・B-166
- **見張り**：なし／**要る試験**：部品を作ったら：受信箱と友だちの詳細が同じ部品を読む試験
- **10-09 の数**：(a) 20（v8 9）・(b) 0・(c) 0・(d) 手描き 20（15 板）／写し 0・効く範囲 0 ファイル／0 機能／Pen 0 板

<a id="phone-preview"></a>
## phone-preview スマホのプレビュー

- **役目**：LINE のトークは LinePreview 1つ。LIFF の画面は LIFF のスマホ枠1つ
- **持ち主（コード）**：`apps/web/src/components/shared/line-preview.tsx`・`apps/web/src/components/shared/line-preview.module.css`（部品 `LinePreview`・`LinePreviewMessage`・`LinePreviewCard`）
- **持ち主（Pen）**：`cfVyj`「LINEの見え方/スマホ」
  - 注：LIFF のスマホ枠は未実装（B-158 の 10）
- **見つけ方（コード）**：
  - own-phone：`\b(function|const)\s+\w*(Phone|PhoneFrame|PhonePreview|Preview|MockPhone|Talk)\b\s*[=(]` — スマホの見本を自作
  - phone-frame：CSS の規則に `border-radius:\s*(3\d|4\d|5\d)px` があり — スマホの外枠を CSS で描く
  - (b) の割り当て：画面の CSS の上書きの selector が `phone|preview|bubble` に当たればこの型
  - (c) の割り当て：直書きの selector が `phone|preview|bubble|talk` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - hand-phone：名前 `^スマホ( |$)` — スマホの手描き（部品 cfVyj でない）
- **決まり**：[§6.12-10](v8-design-rules.md)・B-158
- **見張り**：`apps/web/src/components/shared/line-preview.test.tsx`・`apps/web/src/components/shared/line-preview-bubble.test.ts`／**要る試験**：トークの見本を LinePreview の外で描くと落ちる試験
- **10-09 の数**：(a) 76（v8 37）・(b) 3・(c) 88・(d) 手描き 29（8 板）／写し 0・効く範囲 58 ファイル／31 機能／Pen 2 板

<a id="period"></a>
## period 期間の選択

- **役目**：「過去7日／過去30日／過去90日／期間を指定」の1つの部品
- **持ち主（コード）**：**未実装**
- **持ち主（Pen）**：**未定**
  - 注：未実装（B-158 の 5：部品を作る）
- **見つけ方（コード）**：
  - days-list：`\[\s*['"]?(7|28|30)['"]?\s*,\s*['"]?(28|30|90)['"]?\s*(,|\])` — 画面ごとの期間の並び
  - words：`(?:>|['"'])[^<'"']{0,40}(?:直近\s*\d+\s*日|この\s*\d+\s*日|過去\s*28\s*日|28日間)` — 期間の言葉が決まりと違う
  - (c) の割り当て：直書きの selector が `range|period|days` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - other-period：文字 `直近\s*\d+日|この\d+日|28日` — 期間の言葉が決まりと違う
- **決まり**：[§6.12-5](v8-design-rules.md)・[§6.15-7](v8-design-rules.md)・B-158・B-160
- **見張り**：なし／**要る試験**：部品を作ったら：期間を画面で並べると落ちる試験
- **10-09 の数**：(a) 166（v8 95）・(b) 0・(c) 3・(d) 手描き 73（46 板）／写し 0・効く範囲 0 ファイル／0 機能／Pen 0 板

<a id="chart"></a>
## chart グラフ

- **役目**：棒・線・漏斗を共通部品で。色・吹き出し・軸は部品が持つ
- **持ち主（コード）**：`apps/web/src/components/shared/bar-chart.tsx`・`apps/web/src/components/shared/bar-chart.module.css`（部品 `BarChart`・`BarChartEmpty`）
- **持ち主（Pen）**：**未定**
  - 注：線・漏斗は未実装。Pen の部品 ID が無い
- **見つけ方（コード）**：
  - own-chart：`\b(function|const)\s+\w*(Chart|Graph|Funnel|Sparkline|Bars)\b\s*[=(]` — グラフを自作
  - svg-line：`<(polyline|path)\b[^>]*\b(points|d)=\{` — SVG で線を手描き
  - (b) の割り当て：画面の CSS の上書きの selector が `chart|graph` に当たればこの型
  - (c) の割り当て：直書きの selector が `chart|graph|bar\b|bars\b|funnel|spark` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - hand-chart：名前 `グラフ|棒$` — グラフの手描き
- **決まり**：[§6.12-11](v8-design-rules.md)・B-158
- **見張り**：`apps/web/src/components/shared/bar-chart.test.tsx`
- **10-09 の数**：(a) 16（v8 7）・(b) 0・(c) 22・(d) 手描き 108（31 板）／写し 0・効く範囲 2 ファイル／1 機能／Pen 0 板

<a id="external-link"></a>
## external-link 外へのリンク

- **役目**：新しいタブ・↗ の印・rel="noreferrer" を部品が付ける
- **持ち主（コード）**：`apps/web/src/components/shared/text-link.tsx`・`apps/web/src/components/shared/button.tsx`（部品 `TextLink`）
- **持ち主（Pen）**：`g5Db8`「リンク」
  - 注：external は未実装（TextLink・Button に足す）
- **見つけ方（コード）**：
  - blank：`target=["']_blank["']` — 新しいタブを画面で指定
  - open：`window\.open\(` — window.open
  - (c) の割り当て：直書きの selector が `link|external` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - no-arrow：文字 `(を開く|サイトへ|ページへ)$`・文字が `↗` でない — 外へ出る文に ↗ が無い
- **決まり**：[§6.12-12](v8-design-rules.md)・B-158
- **見張り**：なし／**要る試験**：external を作ったら：target="_blank" を画面で書くと落ちる試験
- **10-09 の数**：(a) 85（v8 47）・(b) 0・(c) 48・(d) 手描き 57（46 板）／写し 0・効く範囲 4 ファイル／1 機能／Pen 13 板

<a id="csv"></a>
## csv CSV

- **役目**：「CSVで書き出す」・ファイル名「機能名_YYYY-MM-DD.csv」（日本時間）を共通の関数で
- **持ち主（コード）**：**未実装**
- **持ち主（Pen）**：**未定**
  - 注：未実装（共通の関数を作る）
- **見つけ方（コード）**：
  - blob：`text\/csv` — CSV を画面で組む
  - name-utc：`toISOString\(\)\.slice\(0,\s*10\)[^\n]{0,60}\.csv|\.csv[^\n]{0,60}toISOString` — ファイル名の日付が世界時
  - words：`(?:>|['"'])[^<'"']{0,40}(?:CSV ?出力|CSVダウンロード|CSVをダウンロード|CSV で書き出す|CSVエクスポート|エクスポート)` — ボタンの言葉が「CSVで書き出す」でない
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - space-words：名前 `^CSV で書き出す$` — 「CSV で書き出す」（空きあり。決まりは「CSVで書き出す」）
- **決まり**：[§6.12-7](v8-design-rules.md)・B-158
- **見張り**：なし／**要る試験**：関数を作ったら：text/csv を画面で書くと落ちる試験
- **10-09 の数**：(a) 158（v8 93）・(b) 0・(c) 0・(d) 手描き 80（80 板）／写し 0・効く範囲 0 ファイル／0 機能／Pen 0 板

<a id="primary-button"></a>
## primary-button 主ボタン・ボタン

- **役目**：主＝文字の幅・高さ36・濃い緑の縁＋カードの影・角丸8。言葉は「〇〇を作る」「〜する」
- **持ち主（コード）**：`apps/web/src/components/shared/button.tsx`・`apps/web/src/components/shared/button.module.css`・`apps/web/src/components/shared/icon-button.tsx`・`apps/web/src/components/shared/icon-button.module.css`（部品 `Button`・`IconButton`）
  - 読む変数：`--card-shadow`・`--radius-control`
- **持ち主（Pen）**：`doYdE`「ボタン/主」・`u101P`「ボタン/副」・`LrB2L`「ボタン/危険」・`wDPmk`「ボタン/文字」・`KspUx`「アイコンボタン」
  - 注：主ボタンの縁 #06612f・角丸8の変数は未実装（§6.4）
- **見つけ方（コード）**：
  - green-fill：CSS の規則に `(button|btn|primary|cta|create|submit|save|action)[^{]*\{` と `background(-color)?:\s*(var\(--color-(primary|accent|brand|action-primary)[\w-]*\)|#087a3e|#06c755)` があり、`hover|:disabled` が無い — 緑の主ボタンを CSS で手書き
  - words：`(?:>|['"'])[^<'"']{0,40}(?:新規作成|作成する|新しく作る|変更を保存(?!する)|コピーする)` — ボタンの言葉が決まりと違う（B-146）
  - (b) の割り当て：画面の CSS の上書きの selector が `\bbutton\b|btn|primary` に当たればこの型
  - (c) の割り当て：直書きの selector が `button|btn|primary|cta|action\b` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - green-hand：名前が `^(ボタン\/主|印|字|丸|点)` でない・style に `background-color: #087a3e` と `height: (32|36|40)px` — 緑の主ボタンの手描き（ボタン/主 でない）
- **決まり**：[§6.4](v8-design-rules.md)・[§6.6](v8-design-rules.md)・B-151・B-146・B-159
- **見張り**：`apps/web/src/components/shared/primary-green-contract.test.ts`・`apps/web/src/components/shared/button-migration-contract.test.ts`・`apps/web/src/components/shared/control-dimensions-contract.test.ts`
- **10-09 の数**：(a) 96（v8 49）・(b) 279・(c) 81・(d) 手描き 464（354 板）／写し 18・効く範囲 698 ファイル／151 機能／Pen 277 板

<a id="date-time"></a>
## date-time 日付・時刻の欄

- **役目**：DateField・TimeField・DateTimeField。高さ36・日本時間
- **持ち主（コード）**：`apps/web/src/components/shared/date-field.tsx`・`apps/web/src/components/shared/date-time-field.tsx`・`apps/web/src/components/shared/time-field-v8.tsx`（部品 `DateField`・`DateTimeField`・`TimeField`・`TimeFieldV8`）
- **持ち主（Pen）**：**未定**
  - 注：Pen の部品 ID が対応表に無い（YCOoR は提案の板）
- **見つけ方（コード）**：
  - native：`type=["'](date|time|datetime-local)["']` — 素の日付・時刻の入力
  - utc-today：`new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)` — 「今日」を世界時で作る
  - (b) の割り当て：画面の CSS の上書きの selector が `date|time` に当たればこの型
  - (c) の割り当て：直書きの selector が `date|time|calendar` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：目印なし（写しの比べだけ）
- **決まり**：[§2](v8-design-rules.md)・[§6.11-15](v8-design-rules.md)・B-157
- **見張り**：`apps/web/src/components/shared/date-field.test.tsx`・`apps/web/src/components/shared/time-field-v8.test.tsx`・`apps/web/src/components/shared/date-time-field-width-contract.test.ts`／**要る試験**：type="date|time" を画面で書くと落ちる試験
- **10-09 の数**：(a) 86（v8 43）・(b) 7・(c) 12・(d) 手描き 0（0 板）／写し 0・効く範囲 102 ファイル／48 機能／Pen 0 板

<a id="toggle"></a>
## toggle オン・オフ・選ぶ部品

- **役目**：その場で効く＝Toggle、保存して効く＝Checkbox、3つ以上＝SegmentedControl か RadioCard
- **持ち主（コード）**：`apps/web/src/components/shared/toggle.tsx`・`apps/web/src/components/shared/checkbox.tsx`・`apps/web/src/components/shared/segmented.tsx`・`apps/web/src/components/shared/radio-card.tsx`・`apps/web/src/components/shared/radio.tsx`・`apps/web/src/components/shared/check-card.tsx`（部品 `Toggle`・`Checkbox`・`SegmentedControl`・`RadioCard`・`RadioCardGroup`・`CheckCard`）
  - 読む変数：`--shadow-controls-toggle`
- **持ち主（Pen）**：`bkjTv`「トグル/オン」・`LxHpj`「トグル/オフ」・`dQCCN`「チェック/オン」・`S9U7v`「チェック/オフ」・`dtJVi`「切り替え（3つ）」・`fNPdg`「選ぶカード/オン」・`r3xz1W`「選ぶカード/オフ」
- **見つけ方（コード）**：
  - pressed：`aria-pressed=` — aria-pressed の自作
  - switch：`role=["'](switch|radio|radiogroup)["']` — オン・オフを手書き
  - raw-check：`type=["'](checkbox|radio)["']` — 素のチェック・ラジオ
  - (b) の割り当て：画面の CSS の上書きの selector が `toggle|switch|segment|checkbox|radio` に当たればこの型
  - (c) の割り当て：直書きの selector が `toggle|switch|segment|checkbox|radio` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：目印なし（写しの比べだけ）
- **決まり**：[§6.12-14](v8-design-rules.md)・B-158
- **見張り**：`apps/web/src/components/shared/checkbox.test.tsx`・`apps/web/src/components/shared/segmented-size.test.tsx`・`apps/web/src/components/shared/radio-card-contract.test.tsx`／**要る試験**：aria-pressed を画面で書くと落ちる試験
- **10-09 の数**：(a) 247（v8 162）・(b) 26・(c) 18・(d) 手描き 0（0 板）／写し 0・効く範囲 265 ファイル／98 機能／Pen 87 板

<a id="copy"></a>
## copy コピー

- **役目**：ボタンの文字が「コピーしました」に1.5秒、失敗は「コピーできませんでした」
- **持ち主（コード）**：`apps/web/src/components/shared/copy-text-button.tsx`・`apps/web/src/components/ui/copy-text-button.tsx`（部品 `CopyTextButton`）
- **持ち主（Pen）**：**未定**
  - 注：Pen の部品 ID が無い
- **見つけ方（コード）**：
  - clipboard：`navigator\.clipboard\.writeText` — コピーを画面で組む
  - (c) の割り当て：直書きの selector が `copy` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：目印なし（写しの比べだけ）
- **決まり**：[§6.11-13](v8-design-rules.md)・B-157
- **見張り**：`apps/web/src/components/shared/copy-feedback.regression.test.tsx`／**要る試験**：navigator.clipboard を画面で書くと落ちる試験
- **10-09 の数**：(a) 47（v8 25）・(b) 0・(c) 0・(d) 手描き 0（0 板）／写し 0・効く範囲 2 ファイル／1 機能／Pen 0 板

<a id="steps"></a>
## steps 手順

- **役目**：題のすぐ下・左寄せ・1行。済みの段だけ押して戻れる
- **持ち主（コード）**：`apps/web/src/components/templates/steps.tsx`・`apps/web/src/components/templates/steps.module.css`（部品 `Steps`）
- **持ち主（Pen）**：`NUOgw`「手順」
- **見つけ方（コード）**：
  - old-stepper：`<(Stepper|DialogSteps)\b` — 別の手順の部品
  - own-steps：`styles\.(steps|stepper|wizard|stepList)\b`（持ち主の部品を読んでいないファイルだけ） — 手順を CSS で手書き
  - (b) の割り当て：画面の CSS の上書きの selector が `step` に当たればこの型
  - (c) の割り当て：直書きの selector が `step|stepper|wizard` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - hand-steps：名前 `^作る手順$` — 手順の手描き（部品「手順」でない名前）
- **決まり**：[§2](v8-design-rules.md)・q1xNMz
- **見張り**：`apps/web/src/components/templates/steps.test.tsx`・`apps/web/src/components/shared/stepper-contract.test.ts`
- **10-09 の数**：(a) 34（v8 23）・(b) 9・(c) 77・(d) 手描き 85（85 板）／写し 2・効く範囲 20 ファイル／19 機能／Pen 19 板

<a id="bulk-bar"></a>
## bulk-bar まとめて選ぶ（一括バー）

- **役目**：下から出る白いバー：操作を選ぶ→確かめる→結果。「〇件すべてを選ぶ」
- **持ち主（コード）**：`apps/web/src/components/shared/bulk-bar.tsx`・`apps/web/src/components/shared/bulk-bar.module.css`（部品 `BulkBar`）
  - 読む変数：`--shadow-float`
- **持ち主（Pen）**：`q1tCSK`「一括操作バー」
  - 部品の板の html に書き出されていない ID：`q1tCSK`（文書の記録 `~/lh-work/design/v8/review/PEN-UPDATE-1009.md`・`COMPONENT-MAP.md` にある。(d) の写しの比べはできない）
- **見つけ方（コード）**：
  - own-bulk：`(?:>|['"'])[^<'"']{0,40}(?:件を選択中|件選択中|件を選んでいます|件選択)`（持ち主の部品を読んでいないファイルだけ） — 一括の帯を自作
  - (b) の割り当て：画面の CSS の上書きの selector が `bulk` に当たればこの型
  - (c) の割り当て：直書きの selector が `bulk|selection(Bar)?` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - hand-bulk：名前 `^一括バー$` — 一括バーの手描き
- **決まり**：[§2](v8-design-rules.md)・[§6.11-14](v8-design-rules.md)・B-157
- **見張り**：`apps/web/src/components/shared/bulk-bar.test.tsx`・`apps/web/src/components/shared/bulk-bar-sticky-contract.test.ts`
- **10-09 の数**：(a) 11（v8 7）・(b) 0・(c) 6・(d) 手描き 3（3 板）／写し 0・効く範囲 12 ファイル／9 機能／Pen 0 板

<a id="back-link"></a>
## back-link ページ内の戻る（置かない）

- **役目**：戻るはパンくずと［キャンセル］だけ。「← 〇〇へ」を置かない
- **持ち主（コード）**：`apps/web/src/components/shared/breadcrumb.tsx`・`apps/web/src/components/layout/breadcrumb.tsx`（部品 `Breadcrumb`）
- **持ち主（Pen）**：**未定**
  - 注：置かない型（持ち主はパンくず）。Pen の部品 ID は外側 zUg8S の中
- **見つけ方（コード）**：
  - arrow-back：`['"'>]\s*←\s*[^<'"']{1,24}(へ|に戻る)` — ページ内の「← 〇〇へ」
  - (c) の割り当て：直書きの selector が `back(Link)?\b` に当たればこの型
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：
  - arrow-back：文字 `^←` — ページ内の「← 〇〇へ」
- **決まり**：[§2](v8-design-rules.md)・[§6.8](v8-design-rules.md)・B-143
- **見張り**：なし／**要る試験**：「← 〇〇へ」を画面に書くと落ちる試験
- **10-09 の数**：(a) 53（v8 43）・(b) 0・(c) 6・(d) 手描き 0（0 板）／写し 0・効く範囲 11 ファイル／6 機能／Pen 0 板

<a id="folder-select"></a>
## folder-select 所属フォルダを選ぶ欄

- **役目**：作る・直す画面の「どのフォルダに入れるか」。その場で作れる
- **持ち主（コード）**：`apps/web/src/components/shared/folder-select.tsx`・`apps/web/src/components/shared/folder-select.module.css`（部品 `FolderSelect`）
- **持ち主（Pen）**：`dLffh`「FolderSelect」・`iBuZH`「新しいフォルダを作る」
  - 部品の板の html に書き出されていない ID：`dLffh`・`iBuZH`（文書の記録 `~/lh-work/design/v8/review/PEN-UPDATE-1009.md`・`COMPONENT-MAP.md` にある。(d) の写しの比べはできない）
- **見つけ方（コード）**：
  - select-folder：`<Select\b(?:[^<>]|=>){0,400}?(label|aria-label)=["'][^"']*フォルダ` — フォルダをプルダウンで選ぶ（FolderSelect にする）
  - 除くもの：試験・モック・`app/visual-qa/`・`globals.css`・コメントの行・持ち主のファイル（表の `global.code`）
- **見つけ方（Pen）**：目印なし（写しの比べだけ）
- **決まり**：[§2](v8-design-rules.md)・[§6.13](v8-design-rules.md)・B-127・B-147
- **見張り**：`apps/web/src/components/shared/folder-select.react.test.tsx`・`apps/web/src/components/shared/folder-select-rollout-contract.test.ts`
- **10-09 の数**：(a) 61（v8 45）・(b) 0・(c) 0・(d) 手描き 0（0 板）／写し 0・効く範囲 25 ファイル／18 機能／Pen 0 板
