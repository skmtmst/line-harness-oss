-- 友だち数の日次記録。
--
-- ダッシュボードの「友だち数の推移」を出すために要る。
--
-- いまは friends の登録日から逆算しているが、退会して行ごと消えた友だちは
-- 数に出ないので、過去に遡るほど実態とずれる。間違った線を正しいものとして
-- 出すより、今日から正しく記録するほうがよい。
--
-- 1日1行。cron が JST の日付ごとに書く。
-- 溜まるまで線は引けないので、記録が無い日は逆算で埋め、
-- 画面に「暫定」と出す。
CREATE TABLE IF NOT EXISTS friend_daily_snapshots (
  -- JST の日付（YYYY-MM-DD）。LINEアカウントごとに1行。
  date              TEXT NOT NULL,
  -- どのLINEアカウントぶんか。全体の合計は line_account_id = '' で持つ。
  -- NULL にすると主キーに使えない（SQLite は NULL 同士を別物として扱う）。
  line_account_id   TEXT NOT NULL DEFAULT '',

  -- その日の終わりの状態。
  active            INTEGER NOT NULL DEFAULT 0,
  total             INTEGER NOT NULL DEFAULT 0,
  blocked_by_them   INTEGER NOT NULL DEFAULT 0,
  hidden_by_us      INTEGER NOT NULL DEFAULT 0,

  -- その日に増えた／減った数。差分は active の引き算でも出せるが、
  -- 記録が飛んだ日があると引き算が壊れるので、その日の実数も持つ。
  added             INTEGER NOT NULL DEFAULT 0,
  blocked           INTEGER NOT NULL DEFAULT 0,

  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),

  PRIMARY KEY (date, line_account_id)
);

-- 期間で絞って古い順に読む、が唯一の読み方。
CREATE INDEX IF NOT EXISTS idx_friend_daily_snapshots_date
  ON friend_daily_snapshots (line_account_id, date);
