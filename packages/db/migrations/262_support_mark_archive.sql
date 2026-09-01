-- 公開後・使用後の対応マークを物理削除せず、履歴と設定参照を保ったまま一覧から外す。
ALTER TABLE support_marks ADD COLUMN archived_at TEXT;

CREATE INDEX IF NOT EXISTS idx_support_marks_active
  ON support_marks(archived_at, display_order, created_at);
