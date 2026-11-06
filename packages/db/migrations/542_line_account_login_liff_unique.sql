-- 同時に届いた2件の接続登録が、同じLINE LoginチャネルID・LIFF IDを
-- 別アカウントへ二重保存できないよう、DBの一意制約で塞ぐ（R550）。
-- 付け足すだけの索引で、既存の列は触らない。
--
-- 適用前の読取だけの確認（どちらも0件なら適用してよい）
--   SELECT login_channel_id AS value, COUNT(*) AS n FROM line_accounts
--    WHERE login_channel_id IS NOT NULL GROUP BY value HAVING n > 1
--   SELECT liff_id AS value, COUNT(*) AS n FROM line_accounts
--    WHERE liff_id IS NOT NULL GROUP BY value HAVING n > 1
-- 重複が1件でもあると索引の作成が失敗し、migrationはそこで止まる。
-- 重複行の削除や変更はしない。解消の方針は司令塔の指示を待つ。
--
-- SQLiteの一意索引は NULL を重複とみなさないため、未設定の行は
-- 複数あってもよい。空文字はアプリ側で NULL として保存する。
CREATE UNIQUE INDEX IF NOT EXISTS idx_line_accounts_login_channel_id_unique
  ON line_accounts(login_channel_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_line_accounts_liff_id_unique
  ON line_accounts(liff_id);
