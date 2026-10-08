-- 草稿。番号別承認後に司令塔が適用する。
-- Instagram 同時投稿（設計正本：新規デザイン/2026-10-08_Instagram連携_Instagram同時投稿/Instagram同時投稿_v01.pen
-- WYDjI / yzZ6i / qPEh8 / sKbNq。2026-10-07 利用者承認）。
-- additive-only 規約により CHECK は後から広げられないため、まだ使わない値も最初から入れておく
-- （instagram_status の 'pending'（送信中に落ちた）と 'skipped'（画像なしで出せなかった）は第2段以降で使う）。
ALTER TABLE rt_google_posts ADD COLUMN instagram_enabled INTEGER NOT NULL DEFAULT 0 CHECK(instagram_enabled IN (0,1));
ALTER TABLE rt_google_posts ADD COLUMN instagram_caption TEXT;
ALTER TABLE rt_google_posts ADD COLUMN instagram_status TEXT NOT NULL DEFAULT 'none' CHECK(instagram_status IN ('none','pending','published','failed','skipped'));
ALTER TABLE rt_google_posts ADD COLUMN instagram_media_id TEXT;
ALTER TABLE rt_google_posts ADD COLUMN instagram_permalink TEXT;
ALTER TABLE rt_google_posts ADD COLUMN instagram_error TEXT;
ALTER TABLE rt_google_posts ADD COLUMN instagram_published_at TEXT;
-- 同意済みスコープ。instagram_content_publish を含まない古い接続は画面で「認可が切れています」にして
-- 「Instagram にログインして接続」へ誘導する（新しい画面は作らない）。
ALTER TABLE instagram_connections ADD COLUMN scopes TEXT NOT NULL DEFAULT '';
