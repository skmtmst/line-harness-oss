-- 招待中のメールも含め、同じ店舗の同じメールを2行作らせない（M958）。
--
-- 従来の一意制約（idx_staff_members_password_email）は password_hash ありの
-- 行だけが対象で、招待中（password_hashなし）の行は重複検査が
-- 「読んで→挿入」の確認だけだった。同時に届いた2件が両方作られる窓を、
-- データベースの一意制約で塞ぐ。付け足すだけの索引で、既存の列は触らない。
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_members_tenant_email_unique
  ON staff_members(COALESCE(tenant_id, ''), lower(email)) WHERE email IS NOT NULL;
