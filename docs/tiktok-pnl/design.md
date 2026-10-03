# TikTok利益計算の自動化（設計）

対象PR: codex/masato-tiktok-pnl
作成: 2026-09-29（masato / Claude）

## 目的

TikTok Shopの売上から、製造原価・送料・ダンボール・TikTok手数料・アフィリエイト報酬を
差し引いた「本当の利益」を、新しいGoogleスプレッドシートで自動集計する。
既存の手書きPnLシート（6_9月LIVE実績PnL管理）は更新が止まっているため置き換える。

## 全体の流れ

```
EC-CUBE (dtb_nen_tiktok_order)
   │  ①読み取り専用エンドポイント（HMAC署名、差分カーソル）
   ▼
worker cron「tiktok pnl sync」（6時間ごと・external_integrationsゲート）
   │  ② D1 tiktok_pnl_order_lines に upsert（変化した行だけ sheet_dirty=1）
   ▼
Googleスプレッドシート「TikTok利益計算（自動集計）」
   │  ③ workerは生の明細（A〜L列）だけをRAWで書く
   ▼
   ④ 金額計算はすべてシート側の数式（M〜Y列＋各タブ）
```

- Google認可は既存の google_sheets_integrations（#838）の refresh_token を使い回す。
  新しいOAuthは作らない。連携が connected のアカウントだけ動く。
- スプレッドシートは workerが雛形から自動作成する（settingsに spreadsheet_id が
  無く、連携が connected のとき）。

## データ（migration `packages/db/migrations/535_tiktok_pnl.sql`）

- `tiktok_pnl_order_lines` — 1行=1注文内の1商品。line_key = `<TikTok注文ID>:<行番号>`。
  sheet_dirty=1 の行だけシートへ書き、成功で0に戻す（差分同期）。
- `tiktok_pnl_settings` — アカウントごとのシートID/URL・取り込みカーソル・
  最終同期時刻・エラー状態。

## workerの実装

- `apps/worker/src/services/tiktok-pnl.ts`
  - `processTiktokPnlTick` — cron入口。connected連携を列挙し、
    featureゲート（'external_integrations', 'tiktok pnl sync'）を通ったアカウントだけ実行。
  - `syncTiktokPnlForAccount` — シート作成→EC取り込み→dirty行書き出し→状態保存。
    EC側エンドポイント未配備（404）は 'ec_endpoint_missing' として記録し、
    シート作成・書き出しは続行する（段階配備できる）。
  - シート書き込みは values:batchUpdate / append の RAW。1回の実行で最大2000行、
    200行ずつバッチ。
- `apps/worker/src/routes/tiktok-pnl.ts`
  - GET `/api/integrations/tiktok-pnl/status` — シートURL・最終同期・未反映行数。
  - POST `/api/integrations/tiktok-pnl/sync` — 手動同期（owner/admin、監査
    `tiktok_pnl.manual_sync`）。
- cron登録は index.ts の sixHourlyHeavy レーン。FEATURE_JOB_MANIFESTに
  gatedで分類済み。

## スプレッドシートの構成（workerが自動作成）

タブ: 使い方 / 月次PnL / ランク・枠管理 / 注文明細（自動） / 商品マスタ / 原価マスタ / 設定

- **設定**（利用者が編集する変数）: 送料1,100円/件、ダンボール30円/箱、
  TikTok手数料7%、＊商品の報酬率80%、非＊商品の設定中報酬率20%、
  80%枠上限102点/月、ランク表（0点→20%スタート、101点→22%シルバー、
  667点→25%VIPゴールド）。
- **原価マスタ**: ミンチ424 / ジャーキー473 / 骨（アバラ骨）594 / ボーンブロス300
  （梱包資材込み・利用者指定の正値）。
- **商品マスタ**: セット→各袋数（BOM）。点数=袋数合計、原価=Σ袋数×単価。
  未登録商品は明細側に⚠️が出る。
- **注文明細（自動）**: A〜L列=workerが書く生データ。M〜X列=ARRAYFORMULA
  （商品名キー、＊判定、月、点数、原価、報酬率、アフィリ報酬、手数料、粗利、
  発送キー=注文日|購入者、商品登録チェック、集計対象）。Y列=手動除外。
  キャンセルは自動で集計から外れる。返品・返金の除外はY列に理由を書く（手動）。
- **月次PnL**: 月ごとに 売上・原価・アフィリ報酬・手数料・発送件数
  （COUNTUNIQUE(発送キー)＝同日同一購入者は1箱）・送料・ダンボール・
  広告費(手入力)・その他(手入力)→営業利益・利益率。
- **ランク・枠管理**: 非＊商品の累計点数から現在ランクをVLOOKUP。
  TikTok側の設定率（設定タブ）と食い違うと⚠️「TikTok側の％引き上げが必要」
  を表示。＊商品の当月点数と80%枠上限の残りも表示。

## EC-CUBE側エンドポイント仕様（実装済み）

EC側は nen-petfood-eccube リポジトリに実装済み。

- 実装: `eccube/app/Customize/Controller/LineHarnessTikTokOrderExportController.php`
  （route名 `nen_line_harness_tiktok_order_export`。`services.yaml` で
  `$secret: '%env(string:LINE_HARNESS_EVENT_SECRET)%'` を明示注入している）
- worker側は404を `'ec_endpoint_missing'` として扱うため、EC配備が後でも
  シート作成・書き出しは進む（段階配備の経路は残してある）。

- `POST /line-harness/tiktok-order-export`
- 認証: 既存line-harness系と同じ HMAC。ヘッダ `X-Nen-Timestamp`（epoch秒）、
  `X-Nen-Signature: sha256=<小文字hex HMAC-SHA256(secret, timestamp + "." + body)>`。
  この契約は `apps/worker/src/services/tiktok-pnl-ec-contract.test.ts` で固定している。
- 秘密設定名の対応: worker側 `ECCUBE_WEBHOOK_SECRET` ＝ EC側 `LINE_HARNESS_EVENT_SECRET`
  （同じ値を別名で読む）。EC側は32文字未満、`X-Nen-Timestamp` が数字以外、
  現在時刻との差が±300秒超のいずれかで401を返す。
- リクエスト: `{"since": "<前回のnext_since|null>", "limit": 200}`
  （EC側で `min(limit, 200)`。0以下は400）
- レスポンス:

```json
{
  "success": true,
  "orders": [
    {
      "tiktok_order_id": "...",
      "ordered_at": "ISO8601",
      "paid_at": "ISO8601|null",
      "status": "DELIVERED など生値",
      "buyer_key": "同一購入者判定用の正規化ID",
      "updated_at": "ISO8601",
      "lines": [
        {
          "index": 0,
          "sku": "...",
          "product_name": "＊鹿肉ミンチ3点セット など",
          "quantity": 1,
          "unit_price_yen": 3980,
          "line_amount_yen": 3980
        }
      ]
    }
  ],
  "next_since": "不透明カーソル（updated_at昇順＋同時刻タイブレーク）",
  "has_more": false
}
```

- 並び: `ORDER BY t.update_date ASC, t.id ASC`（同時刻はDB内部IDでタイブレーク）。
  `limit + 1` 件取って `has_more` を判定する。カーソルはworker側では解釈せず
  そのまま返す。
- `buyer_key`: 購入者メール、無ければ電話番号を小文字化し、同じ秘密値で
  HMAC-SHA256して先頭16文字に切った値。どちらも無い注文は `order-<TikTok注文ID>`。
  個人情報そのものはworker・D1・シートへ渡さない。
- データ源: `dtb_nen_tiktok_order.payload_json`。読み取り専用でEC側の状態は変えない。
  このエンドポイント用のDB変更は無い（EC側migration追加なし）。

## 運用メモ

- worker側の環境変数は既存の `NEN_EC_BASE_URL` / `ECCUBE_WEBHOOK_SECRET` を使い、
  新規追加なし。未設定のときは取り込みをスキップ（シート作成・書き出しは動く）。
- EC側は `NEN_TIKTOK_PNL_SHEET_URL` を1件追加した。管理画面ホームに利益計算シートへの
  リンクを出す `Customize\EventSubscriber\AdminHomeTikTokPnlSubscriber` が読む。
  取り込み自体には関係しないため、未設定でもエクスポートは動く。
- 返品・キャンセルの扱い: キャンセルは自動除外、返金は明細Y列に手動で記入。
- 80%枠の上限（現在102点/月）は設定タブで変更できる。
