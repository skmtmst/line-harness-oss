# 監査2本目：画面から呼ぶAPI（2026-10-08）

## 件数の取得

全件を一覧から取得して数えず、以下を使う。権限とアカウント範囲はサーバーで確認する。失敗は0件へ変換しない。

|呼び出し|経路|返す値|
|---|---|---|
|`api.automations.counts(accountId)`|`GET /api/automations/counts?account_id=...`|`rules`, `commonActions`, `templates`|
|`api.conversionApprovals.counts()`|`GET /api/conversions/approvals/counts`|`pending`, `approved`, `rejected`, `total`（紹介の承認一覧と同じ担当範囲）|
|`api.media.counts(accountId)`|`GET /api/media/counts?accountId=...`|`total`, `byKind`（image/video/audio/file）, `unused`, `archived`|
|`api.hqBilling.preview(planKey, interval)`|既存 `GET /api/hq/billing/preview`|`afterAmountYen`, `amountDueYen`, `prorationDifferenceYen`, `nextBillingAt`, `estimatedAt`, `isEstimate`, `notice`など|

呼び出し結果は共通の `ApiResponse` なので、件数は `response.data` から読む。

```ts
const { data } = await api.media.counts(accountId)
// data.byKind.image / data.unused / data.archived
```

請求の `interval` は `month` / `year`、省略時 `month`。課金対象外の統括のプラン変更APIは追加していない。

## 対象アカウントが付いた合図

`SESSION_LOST_EVENT` と `FEATURE_DISABLED_EVENT` は `CustomEvent`。`event.detail.accountId` を、画面が現在表示しているアカウントと比較して使う。後から画面のアカウントを読むと、返事が遅れたときに別店舗へ影響する。

- リクエスト開始時の `account_id` / `accountId` / `line_account_id` / `lineAccountId`、ヘッダー、JSON本文から対象を固定する。
- `fetchApi` の追加オプション `accountId` で明示も可能。ブラウザーの通信オプションには流さない。
- 複数店舗では `accountId: null` と `accountIds`。対象不明も `accountId: null`。現在の表示店舗で補わない。
- 機能オフの場合は `featureId` も返す。通常の403、追加認証の401で誤った合図を出さない。
- JSON取得、ファイル取得、ダウンロードの経路で同じ契約を使う。

## 統括の吹き出し

既存の統括配信の作成・確認・実行APIへ店と同じ `messageBubbles`（または `messageBubblesJson`、同時指定不可）を送る。画像・動画・スタンプ・カルーセル・Flex・クーポン・リッチ素材を店側と同じ送信組立で扱う。店舗名と `{{liff_id}}` は店舗別に置き換えた本文を子配信へ保存する。必要なLIFF IDがない店舗は予約前に止める。

統括のひな形から読み込む吹き出しは、すべての種類で次の情報を `content` に残す。

```ts
content: {
  hqTemplateId: '統括のひな形ID',
  hqTemplateVersionId: '読み込んだ不変の公開版ID',
  // その他は店の吹き出しと同じ本文・URL・columnsJsonなど
}
```

既存の成功した配布記録から、その店舗・同じ統括版に対応するひな形ID、素材ID、公開URL、postback内のIDを付け替える。別テナント、別店舗、保管済み素材、未配布の版は409で止める。新しい表・マイグレーションは不要。未配布店舗への自動配布は追加していない。

**Claude側の残作業**：現状の画像・テキスト・Flexの読み込みでは元のひな形IDが落ち、カルーセルでは版IDが無い。画面で上記2項目を保持する。インラインで作った吹き出しには統括のIDを付けない。

## 統合時の注意

Codex 3/5/6/7の修正と共有ファイルが重なる。司令塔が先にどの枝を採用するかを決め、重複した修正を二重に取り込まず、組み合わせた後に関係する試験を通す。

- 3：`api.ts`、OpenAPI、スコア・マイル・リマインダ・リッチメニューの一部。
- 5：W3/W7/W10。W17は5の控えを読み、2へ当て直して試験した。
- 6：PKG25/52/66。
- 7：PKG17/18/19/20/21/22/31/32/45。PKG41は7の成果を使う。
