-- 登録メディアの「既知の利用期限・同意情報」を記録する欄。
-- 根拠のない権利情報は推定しないため、運用者が確認済みの内容だけを
-- 任意で記録する。未記録（NULL）は「不明」として画面に出す。

ALTER TABLE media ADD COLUMN usage_expires_at TEXT;
ALTER TABLE media ADD COLUMN usage_consent_note TEXT;
