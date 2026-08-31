# 機能4 GMvBd 対応マーク自動変更 — 画面実装への引き継ぎ

## 対象

- Pencil V6 Node: `GMvBd`
- ルート: `/tags?tab=marks`
- 画面の役割: 対応マークの名前・色・並び順・初期値と、自動変更ルールを同じ面で管理する

## 正本

ルールは新しい表へ複製せず、V6の `automation_definitions` / `automation_versions` に保存する。
公開版は書き換えず、編集のたびに新しい公開版を作る。削除は履歴を消さずアーカイブする。

## API

すべて `lineAccountId` が必須。owner/admin だけが操作できる。

- `GET /api/support-marks/:markId/automation-rules`
- `POST /api/support-marks/:markId/automation-rules`
- `PATCH /api/support-mark-rules/:ruleId`
- `DELETE /api/support-mark-rules/:ruleId`

更新・削除は `expectedVersion` が必須。競合時は `409` と
`SUPPORT_MARK_RULE_VERSION_CONFLICT` を返すので、画面は保存済みとせず読み直しを促す。

## 保存する形

```ts
type SupportMarkAutomationRule = {
  id: string
  name: string
  markId: string
  event:
    | 'message_received'
    | 'manual_reply_sent'
    | 'staff_assigned'
    | 'response_overdue'
    | 'condition_matched'
  condition: SegmentCondition | null
  priority: number
  manualProtectionMinutes: number
  isActive: boolean
  version: number
  updatedAt: string
}
```

画面用のAPI呼び出しは `api.supportMarks.automationRules`、
`createAutomationRule`、`updateAutomationRule`、`archiveAutomationRule` に追加済み。

## 動作の決めごと

- 同時に複数ルールへ合う場合は、優先順位が最も高い1本だけを実行する。
- `condition_matched` は、受信・返信・担当割当・期限超過の各出来事で友だち条件を再評価する。
- 手動変更後は `manualProtectionMinutes` の間、自動変更で上書きしない。
- 変更履歴へ変更前・変更後・自動処理ID・版・きっかけを残す。
- 返信期限超過は会話IDと期限時刻を不変IDにし、Cronが再実行されても二重変更しない。
- 別のLINE公式アカウントのマーク・友だち・ルールは404または実行失敗として扱う。

## 画面状態

撮影用固定データは `SUPPORT_MARK_AUTOMATION_RULES` に通常2件、
`SUPPORT_MARK_AUTOMATION_RULES_EMPTY` に空、
`SUPPORT_MARK_AUTOMATION_RULES_ERROR` に失敗を用意している。
画面では次を混ぜない。

- 読込中
- 取得できて0件
- 取得失敗
- 権限不足
- 版競合

## 画面側の完了条件

1. きっかけ・変更先・条件・優先順位・手動変更の保護時間を確認して保存できる。
2. 優先順位が実際の実行順と同じ順に見える。
3. 競合時に窓を閉じず、最新内容を読み直せる。
4. 取得失敗を「ルールはありません」と表示しない。
5. 1440px / 1920pxでページ・一覧とも横スクロール0。
6. Pencil V6 `GMvBd` と同じ状態・幅の画像を並べて比較する。
