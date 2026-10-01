-- 候補547 rollback（論理rollback第一案。列・receiptは残す）
--
-- 方針: ADD COLUMN の取消は表作り直しになるため実行可能な rollback と
-- 称さない。第一案は flag OFF＋receipt保持＋列保持の安全手順。
-- 手順:
--   1. tenant設定 feature.v8_versioned_save を OFF（新規約の要求停止。
--      新writerを停止し、処理中操作と旧writer互換を確認してから旧契約へ戻す）。
--   2. v8_edit_receipts は監査証跡として保持する（削除しない）。
--   3. lock_version 列は残す（無害とは一律断定せず、旧writerとの互換を確認。削除しない）。
--   4. 物理復元が必要な場合は適用前の D1 エクスポートからの復元を
--      別承認・保守時間・後続書込の保全確認の上で行う。
--      短いSQLで安全に戻せるとは言わない。

-- 確認（読取のみ。実行安全）:
SELECT COUNT(*) AS receipts_kept FROM v8_edit_receipts;
