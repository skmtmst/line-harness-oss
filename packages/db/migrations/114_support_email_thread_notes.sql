-- メールのスレッドにメモを持たせる。
--
-- 受信箱では LINE のトークにメモ欄があるのに、メールには無かった。
-- 同じ受信箱の中で、相手がメールというだけで残せないのは扱いが揃っていない。
--
-- ALTER は1文だけにする。D1 は1ファイルに複数の ALTER を入れると
-- 途中で落ちることがあり、_migrations に記録も残らない（113 で踏んだ）。
ALTER TABLE support_email_threads ADD COLUMN notes TEXT;
