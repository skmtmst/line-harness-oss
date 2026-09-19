-- 機能08 点検（E-01・N-085）: 自動応答の専用停止口と履歴を残す削除。
--
-- stopped_* は「最後に停止した記録」。再び動かしても消さず、
-- いつ・誰が・なぜ止めたかを運用の履歴として残す。
-- deleted_at は物理削除の代わり。設定と過去の一致記録を残し、
-- 一覧・評価・集計では deleted_at IS NULL の行だけを見る。

ALTER TABLE auto_replies ADD COLUMN stopped_at TEXT;
ALTER TABLE auto_replies ADD COLUMN stopped_by_staff_id TEXT;
ALTER TABLE auto_replies ADD COLUMN stop_reason TEXT;
ALTER TABLE auto_replies ADD COLUMN stop_idempotency_key TEXT;
ALTER TABLE auto_replies ADD COLUMN deleted_at TEXT;
ALTER TABLE auto_replies ADD COLUMN deleted_by_staff_id TEXT;
