# 提案E：来店の記録（2026-10-07）

管理APIはログインと店舗の権限が必要です。飲食店APIには既存と同じ `account_id`（または統括の選択）を付けます。

| 口 | 入力 | 返り値 |
| --- | --- | --- |
| `POST /api/restaurant-test/reservations/:id/visit` | `kind: visited/late/no_show`、lateだけ`lateMinutes` | `status`、`visit_mark`（担当者・日時） |
| `DELETE /api/restaurant-test/reservations/:id/visit` | 予約ID | 戻した`status` |
| `POST /api/restaurant-test/reservations/walk-in` | `storeId, guestCount, tableId`。`customerName, customerPhone, lineUid`は任意 | `id, tableId, status: visited, source: walk_in, startsAt, endsAt` |
| `GET /api/restaurant-test/customers/history` | `storeId`と電話または`lineUid` | 既存の来店回数・来店履歴 |

新しい来店済みは`visited`。以前の`seated`も来店済みとして履歴に数えます。印の取消は削除せず、担当者・時刻を残します。ウォークインの時刻は現在、滞在時間は既存の標準値です。卓の定員・予約・仮押さえ・キャンセル待ちと競合すると409になります。氏名・電話がない記録は保存できますが、友だちの特定にはLINEの紐付けが必要です。

マイグレーション草稿：594。番号ごとの承認後に適用します。
