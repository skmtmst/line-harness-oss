# V6 3-1-D 友だち一括操作（IAf7j）画面引き継ぎ

## 正本

- Node: `IAf7j`
- 画面: `/friends`
- 契約: `packages/shared/src/friend-bulk-runs.ts`
- 画面のAPIクライアント: `api.friends.bulkPreview / bulkCreate / bulkGet / bulkRetry / bulkUndo`
- 押し口: `data-qa-open="IAf7j"` を付ける

## API

- 一括操作と実行結果はオーナー・管理者だけが扱える。スタッフ権限では個別操作の権限を越えるため表示・実行しない。
- 実行結果・再試行・取り消しは、現在その担当者が見られるLINE公式アカウントだけで構成された実行に限る。IDを知っていても担当外は404にする。

1. `POST /api/friends/bulk-runs/preview`
   - body: `{ selection, operation }`
   - 作成前に必ず呼ぶ。選択条件はサーバーが再計算する。
2. `POST /api/friends/bulk-runs`
   - body: `{ selection, operation, scheduledAt? }`
   - `Idempotency-Key` 必須。
   - 取り消せない操作は `X-Confirm-Irreversible: friend-bulk-run` 必須。
3. `GET /api/friends/bulk-runs/:id?page=1&limit=50`
   - 最大100件ずつ。`items / page / limit / total` を返す。
4. `POST /api/friends/bulk-runs/:id/retry`
   - 失敗した対象だけを再実行する。成功済みは触らない。
5. `POST /api/friends/bulk-runs/:id/undo`
   - `Idempotency-Key` 必須。取り消せる操作だけ別の実行として記録する。
   - 一括操作のあとに人が変更した対象は上書きせず、その対象だけ「あとから変更されているため取り消さない」と記録する。

## 画面状態

- 通常: `FRIEND_BULK_RUN.preview`。選択4人、対象3人、対象外1人をそのまま表示する。
- 空: `selectedCount=0 / targetCount=0 / excludedCount=0 / sample=[]`。取得できた0人として表示する。
- 失敗: APIエラーとして面を分ける。人数を0にせず `—` とし、実行ボタンを出さない。
- 権限不足: 候補や個人情報を描かず、権限の案内だけにする。
- 一部失敗: `FRIEND_BULK_RUN.detail`。成功2人と一時失敗1人を混ぜず、再試行は失敗だけと明記する。

## 受入条件

- 対象人数、対象外人数、アカウント別内訳、除外理由、サンプルを確認してから実行する。
- 未取得 `—` と実値0を混ぜない。未取得時は実行できない。
- 取り消せない操作は、それを窓の中に明記して追加確認する。
- 同じ実行を二重送信しない。409は「最新の状態を読み直してください」と表示する。
- 同じ冪等キーでも日時・操作・対象が違う409と、取り消し対象が後から変わった失敗を混ぜない。
- 成功、見送り、一時失敗、恒久失敗を別の言葉で表示する。
- 再試行は失敗だけ。取り消しは取り消せる操作だけ。
- 1440px・1920pxで横スクロール0。内部ID、`API error`、`undefined`、`NaN`、`Invalid Date`を出さない。

## Claudeへの範囲

画面と契約テストを実装する。Worker・DB・migrationは変更しない。通常・空・失敗・権限不足・一部失敗を撮り、台帳は実際に確認したheadだけ更新する。
