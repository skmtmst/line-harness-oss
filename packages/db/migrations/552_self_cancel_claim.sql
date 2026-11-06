-- F6 本人取消の所有権トークン。取消の確定・再送の主張・送信中 rollback を
-- 1つの条件付き UPDATE で結び付ける (同時刻でも uuid で区別できる)。
-- 既存行は NULL のまま。これまでどおり扱う。
ALTER TABLE bookings ADD COLUMN cancel_claim_id TEXT;
