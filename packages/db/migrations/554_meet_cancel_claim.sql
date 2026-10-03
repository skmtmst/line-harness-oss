-- F6 Meet 相談の取消操作の所有権トークン。取消の確定と送信中 rollback を
-- 同じ操作の uuid に結び付ける (同版の別操作が巻き戻せない)。
-- 既存行は NULL のまま。これまでどおり扱う。
ALTER TABLE meet_consultations ADD COLUMN cancel_claim_id TEXT;
