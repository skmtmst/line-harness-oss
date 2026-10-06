# 流入リンクを作る（V8）の動き

入口：`app/inflow-links/new/page.tsx`（V8 のときだけ `src/v8/inflow-links/new/create.tsx`、それ以外は今の画面）。
絵：作る `KMaMk`・競合 `vWJEm`・競合の比べ `E14GFm`。

## 受け付ける URL と指定
- `/inflow-links/new`
- `?name=<名前>`・`?ref=<見分けるための文字>`：**新しく足した**。入れて開く（ref が無ければ名前から候補を作る。今と同じ作り方）

## 呼ぶ口（今の画面と同じ）
- 候補：`tags.list({ accountId })`・`tagGroups.list(accountId)`・`scenarios.list({ accountId })`・`templates.list(undefined, accountId)`・`entryRouteGenres.list()`・プールは機能が有効なときだけ `pools.list`
- アカウントを切り替えたら候補を取り直し、今のアカウントに無い選択は外して帯で知らせる
- 発行：`entryRoutes.create({ name, genre, refCode, tagId, scenarioId, introTemplateId, poolId, redirectUrl, isActive, lineAccountId })` → 詳細 `/inflow-links/detail?id=…` へ
- 409（見分けるための文字が使用中）：`entryRoutes.list(accountId)`、無ければ `entryRoutes.list()` から同じ文字のリンクを探し、見つかれば競合の帯
- 失敗の言葉は `describeApiFailure`（403 は権限の案内）
- 入力の途中で離れるときは確認を出す（`useUnsavedGuard`）

## 今の画面と変えたところ（見せ方だけ）
- 競合の帯は板の頭の下に板いっぱいで出す。主ボタンは「比べてから保存」
- 「違いを比べる」は窓（E14GFm）。違う項目だけ（名前・フォルダ・友だちになったら・行き先 URL・追加先・公開）を並べ、「最新を取り込んで直す」で保存されている値を入力へ写す。見分けるための文字は使用中なので上書きはしない
- 友だちの追加先の説明（所属するアカウント・いっぱいのときの振り分け）は「?」の中
- 名前の「必須」の札は出さない（空のまま発行すると今と同じ言葉で止める）
- 右の列：お客さまの進む順の箱と、本物のスマホの形の見え方（共通の LinePreview。題は進む順の題が兼ねる）

## 撮影の指定（対応表への提案）
- `vWJEm`：`url: /inflow-links/new?name=夏のInstagram投稿&ref=summer-ig`、`api: { match: "POST /api/entry-routes", status: 409 }`、`click: "発行して URL を受け取る"`
- `E14GFm`：上と同じ ＋ `click: ["発行して URL を受け取る", "違いを比べる"]`
