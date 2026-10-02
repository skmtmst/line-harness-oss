-- 454: 一斉配信の二者承認（承認の今の状態を配信行に持つ）。
-- 付け足すだけ。既存の列を消さない・型を変えない。
-- approval_status は status（送信の段階）とは別の軸。status の CHECK は触らない。
ALTER TABLE broadcasts ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'none';
-- 承認を頼んだ担当者（送る人）。
ALTER TABLE broadcasts ADD COLUMN approval_requested_by_staff_id TEXT;
-- 承認を頼んだ日時（JST）。
ALTER TABLE broadcasts ADD COLUMN approval_requested_at TEXT;
-- 承認を頼まれた担当者（承認する人）。
ALTER TABLE broadcasts ADD COLUMN approval_approver_staff_id TEXT;
-- 承認を頼むときのひとこと（任意）。
ALTER TABLE broadcasts ADD COLUMN approval_note TEXT;
-- 承認・差し戻しを決めた担当者。
ALTER TABLE broadcasts ADD COLUMN approval_decided_by_staff_id TEXT;
-- 承認・差し戻しを決めた日時（JST）。
ALTER TABLE broadcasts ADD COLUMN approval_decided_at TEXT;
-- 差し戻しの理由（差し戻すとき必須）。
ALTER TABLE broadcasts ADD COLUMN approval_reject_reason TEXT;
-- 1人運用のとき、送る人が確認で入れた人数。送信時点の宛先数と突き合わせる。
ALTER TABLE broadcasts ADD COLUMN approval_confirmed_count INTEGER;
CREATE INDEX IF NOT EXISTS idx_broadcasts_approval_status ON broadcasts (approval_status);
CREATE INDEX IF NOT EXISTS idx_broadcasts_approval_approver ON broadcasts (approval_approver_staff_id);
