-- フォーム回答の冪等キー。同じ回答の再送・連打を1回だけ受理し、
-- 特典やマイルの二重付与を防ぐ(#646)。
-- 送信時に Idempotency-Key ヘッダの UUID を回答行の id として使う。
-- 同じ id の再送は保存済みの行を返し、内容が違う使い回しは 409 で断る。
-- idempotency_hash は回答内容の照合用、idempotency_expires_at は
-- 再送を受け付ける期限(UTC ISO8601)。期限切れの再送は安全に断り、
-- 新しいキーでの送り直しを求める。回答自体は残し、消さない。
ALTER TABLE form_submissions ADD COLUMN idempotency_hash TEXT;
ALTER TABLE form_submissions ADD COLUMN idempotency_expires_at TEXT;
CREATE INDEX IF NOT EXISTS idx_form_submissions_idempotency_expires
  ON form_submissions (idempotency_expires_at);
