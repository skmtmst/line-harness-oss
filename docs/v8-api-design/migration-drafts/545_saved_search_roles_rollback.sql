-- 候補545 rollback（論理rollbackのみ。表は残し、DROPしない）
--
-- 方針: 第一案かつ唯一案は論理rollback。DROPは選択肢にしない。
-- 手順:
--   1. tenant設定 feature.v8_saved_search_roles を OFF。
--      selected_roles付きデータは is_shared=0（private）扱いに戻る。
--   2. 共有設定の新規変更を停止し、下の確認で使用中がないことを見る。
--   3. 物理復元が必要な場合は適用前の D1 エクスポートからの復元を
--      別承認・保守時間・後続書込の保全確認の上で行う。

-- 確認（読取のみ。実行安全）:
SELECT COUNT(*) AS roles_in_use FROM saved_search_share_roles;
