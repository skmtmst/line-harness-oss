-- 自動返信の条件。これまでキーワードと一致方法だけで、
-- 「営業時間外だけ返す」「同じ人へ連続して返さない」が表現できなかった。

-- 返す時間帯。NULL なら時間帯を問わない。JST の HH:MM で持つ。
ALTER TABLE auto_replies ADD COLUMN active_from TEXT;
ALTER TABLE auto_replies ADD COLUMN active_until TEXT;

-- 同じ相手への再送を抑える間隔（分）。NULL なら抑制しない。
ALTER TABLE auto_replies ADD COLUMN cooldown_minutes INTEGER;

-- 担当者が対応中のトークでは自動返信を止めるか。既定は止めない（従来どおり）。
ALTER TABLE auto_replies ADD COLUMN skip_when_operator_active INTEGER NOT NULL DEFAULT 0;
