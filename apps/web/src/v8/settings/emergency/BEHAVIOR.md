# 運用状態の動き（BEHAVIOR.md）

対象：`screen.tsx`・`health.tsx`（★V8 健全性チェック `Y4LkX1`）。更新履歴（`I2V65v`）・緊急コントロール（`OHwbU`）は今の部品を入口から差し込む。
写し元：`app/emergency/page.tsx` の EmergencyPageInner・HealthPanel・OperationAlertsPanel。

## 入口・URL
- `app/emergency/page.tsx`：見た目が v8 のときだけこの画面。`?tab=health|history|control`。

## 読み込み（API）
- `GET /api/operations/health`（手動は `POST …/runs`）・`GET /api/operations/alerts`・`GET /api/operations/history`（下の3枚）・`api.health.accounts()`。
- 初回だけ読み込み中、5分ごとに取り直す（隠れたタブでは取らない）。手動確認は連打を止め、世代とアカウントで古い応答を捨てる（N-458）。
- 古い確認（10分より古い）と未確認を言い分ける（A32-01）。異常が読めないときは「異常なしとは扱いません」。

## 操作
- いますぐ確かめる（頭の右）。開いている異常：受領する（1回目でメモ欄、2回目「受領を記録する」で記録）・通知をやり直す。
- 見るだけの人：受領・やり直し・緊急停止のボタンを出さない。
