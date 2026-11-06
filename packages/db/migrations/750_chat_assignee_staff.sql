-- 新しい担当だけユーザー管理を参照する。旧担当の記録はそのまま残す。
-- ユーザー削除後もIDを残し、旧担当へ戻さず「担当者不明」と表示する。
ALTER TABLE chats ADD COLUMN assignee_staff_id TEXT;
CREATE INDEX idx_chats_assignee_staff ON chats(assignee_staff_id);
