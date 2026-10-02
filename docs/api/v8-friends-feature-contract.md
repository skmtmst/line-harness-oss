# V8 友だち追加機能の API（F-1・F-2）

## 一括操作（F-1）

既存の実行処理を使用する。画面の選択肢はこの変更では変えない。

- `POST /api/friends/bulk-runs/preview`：`{ selection, operation }` を受け、`{ success, data: { selectedCount, targetCount, excludedCount, accountBreakdown, exclusions, sample, reversible } }` を返す。
- `POST /api/friends/bulk-runs`：同じ対象・操作と任意の `scheduledAt` を受け、実行の ID・状態・件数を返す。`Idempotency-Key` は必須。送信・共通アクションは `X-Confirm-Irreversible: friend-bulk-run` も必要。
- `GET /api/friends/bulk-runs/:id`：実行の状態、対象・除外・成功・スキップ・一時失敗・恒久失敗の件数と、対象ごとの結果を返す。従来の項目は維持し、`approval` を追加する。
- `POST /api/friends/bulk-runs/:id/approve`：`{}`、1人運用なら `{ confirmedRecipientCount: 人数 }` を受け、`{ success: true, data: { approval } }` を 202 で返す。送信自体の終了は上記 GET で確認する。

操作の `kind` は `send_message`、`assign_operator`、`start_scenario`、`stop_scenario`、`set_support`、`set_reminder`、`cancel_reminder`、`run_common_action`。タグなどの従来の操作も引き続き使用できる。操作の指定項目は共有の `FriendBulkOperation` 契約を保つ。

作成・詳細の `data.approval` は不要なとき `null`、必要なときは次の形。

```json
{
  "status": "pending",
  "recipientCount": 1000,
  "threshold": 1000,
  "requestedBy": "操作した担当者のID",
  "decidedBy": null
}
```

状態は `pending`（承認待ち）、`approved`（別担当が承認）、`confirmed`（1人運用で人数一致）、`expired`（予約時刻を過ぎた）。承認待ちの実行は従来の `status: waiting` とし、Cron・再試行・直接処理のいずれでも送らない。

承認基準は一斉配信と共通の設定を使用する。既定は1,000人以上、複数アカウントでは厳しい基準を使う。運用者が複数いるときは依頼者自身の承認を拒否する。1人運用では対象人数が一致した場合だけ進める。送信前に運用者が増えていたら別担当の承認へ戻す。予約時刻を過ぎた承認は拒否し、対象と内容を確認して新しく作成する。依頼・承認・人数確認・期限切れを履歴に残す。

対象は作成時に固定され、再試行でも増えない。承認機能追加前に作られた実行も、処理時に現在の人数基準を検査する。

## 重なって届いた配信（F-2）

`GET /api/duplicates/stats` の既存の `data` に `overlappingDeliveryCount: number | null` を追加する。従来の項目は削除・改名しない。

集計するのは、現在同じ統合ユーザーに結び付いた友だちへの一斉配信の送信実績。テスト送信と一斉配信以外は除く。配信・統合ユーザーごとに、友だち別の通数の合計から1友だち分の最大通数を引く。同じ配信に本文が2通ある場合、その2通は正規の送信として残す。実績は現在の関連付けで数え、未統合の人を名前・画像の類似から同一人物と推測しない。

閲覧可能なアカウントだけで計算し、取得不能は `null`、取得できて重複がない場合は `0`。LINE が受け付けた送信の記録から数える値であり、既読数ではない。

## 検証・適用

migration は `548_friend_bulk_message_approval.sql`。公開中PRが544・545・546・547を使用中のため、未使用の548へ移した（未pushのため改名可）。D1 への適用と配備は行っていない。

F-3 は新規友だちの作成時に引き継ぐ情報と、切り戻し時に新規友だちを残すかどうかの確認待ち。既存の UID移行の処理は変更していない。
