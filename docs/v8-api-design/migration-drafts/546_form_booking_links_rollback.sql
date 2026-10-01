-- 候補546 rollback（論理rollback第一案。表は残す）
--
-- 方針: 第一案は論理rollback。処理中/履歴の表は保持する。
-- 手順:
--   1. tenant設定 feature.v8_form_booking を OFF（新規受付停止）。
--   2. 下の確認で pending/compensating の行がゼロであることを見る。
--      残がある間は回収を優先する。
--   3. データ退避と参照停止を確認しても、本草稿の手順ではDROPしない。
--      対象は form_booking_links と form_booking_claims の両方。
--   4. 物理復元が必要な場合は適用前の D1 エクスポートからの復元を
--      別承認・保守時間・後続書込の保全確認の上で行う。

-- 確認（読取のみ。実行安全）:
SELECT status, COUNT(*) AS n FROM form_booking_links GROUP BY status;
SELECT status, COUNT(*) AS n FROM form_booking_claims GROUP BY status;
