-- 然-NEN- 会員ランク（通年）・ライフタイム・マイル。
--
-- ランクのしきい値と還元率はこれまでコードに直書きだった（LIFF・タグ同期・EC連携の3か所）。
-- ここで「設定」として持ち、LINE管理画面（専用機能 → 会員）から変えられるようにする。
-- ランクとマイルの計算はEC側で行い、結果を nen_ec_member_snapshots に受け取る。
-- 追加のみ。既存列は変更しない。

-- ランク（アカウントごと）。しきい値は通年（1〜12月の購入額）。
CREATE TABLE IF NOT EXISTS nen_rank_settings (
  id                   TEXT PRIMARY KEY,
  line_account_id      TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  rank_key             TEXT NOT NULL,
  name                 TEXT NOT NULL,
  annual_threshold_yen INTEGER NOT NULL DEFAULT 0 CHECK (annual_threshold_yen >= 0),
  mile_rate_percent    REAL NOT NULL DEFAULT 1 CHECK (mile_rate_percent >= 0 AND mile_rate_percent <= 10),
  -- 自動で付け替える友だち属性タグ（tags.id）。
  tag_id               TEXT,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  UNIQUE (line_account_id, rank_key)
);
CREATE INDEX IF NOT EXISTS idx_nen_rank_settings_account
  ON nen_rank_settings(line_account_id, sort_order);

-- ランクの決まり方と、ECへの同期状態（アカウントごとに1行）。
CREATE TABLE IF NOT EXISTS nen_rank_rules (
  line_account_id  TEXT PRIMARY KEY REFERENCES line_accounts(id) ON DELETE CASCADE,
  year_start_month INTEGER NOT NULL DEFAULT 1 CHECK (year_start_month BETWEEN 1 AND 12),
  apply_on_reach   TEXT NOT NULL DEFAULT 'immediate' CHECK (apply_on_reach IN ('immediate')),
  keep_until       TEXT NOT NULL DEFAULT 'end_of_next_year' CHECK (keep_until IN ('end_of_next_year')),
  count_orders     TEXT NOT NULL DEFAULT 'paid_excluding_cancel_refund' CHECK (count_orders IN ('paid_excluding_cancel_refund')),
  -- 保存のたびに +1。ECはこの番号で冪等に受け取る。
  version          INTEGER NOT NULL DEFAULT 1,
  sync_status      TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending', 'synced', 'failed')),
  sync_error       TEXT,
  synced_at        TEXT,
  updated_at       TEXT NOT NULL
);

-- ライフタイム（累計購入額）の節目。特典は未設定のまま持てる。
CREATE TABLE IF NOT EXISTS nen_lifetime_milestones (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  threshold_yen   INTEGER NOT NULL CHECK (threshold_yen > 0),
  title           TEXT NOT NULL,
  benefit_kind    TEXT,
  benefit_note    TEXT,
  notify_on_reach INTEGER NOT NULL DEFAULT 1 CHECK (notify_on_reach IN (0, 1)),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nen_lifetime_milestones_account
  ON nen_lifetime_milestones(line_account_id, threshold_yen);

-- ECから受け取る計算結果。既存の purchase_amount / point_balance / member_rank は残す。
ALTER TABLE nen_ec_member_snapshots ADD COLUMN annual_miles_yen INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nen_ec_member_snapshots ADD COLUMN lifetime_miles_yen INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nen_ec_member_snapshots ADD COLUMN member_rank_key TEXT;
ALTER TABLE nen_ec_member_snapshots ADD COLUMN mile_rate_percent REAL;
ALTER TABLE nen_ec_member_snapshots ADD COLUMN rank_valid_until TEXT;
ALTER TABLE nen_ec_member_snapshots ADD COLUMN mile_balance INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nen_ec_member_snapshots ADD COLUMN miles_used_this_month INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nen_ec_member_snapshots ADD COLUMN last_purchased_at TEXT;

-- ECの値が届くまでの暫定値。累計＝これまでの足し算、残高＝これまでのポイント残高。
UPDATE nen_ec_member_snapshots
   SET lifetime_miles_yen = purchase_amount,
       mile_balance = point_balance
 WHERE lifetime_miles_yen = 0 AND mile_balance = 0;

-- 既存のランクタグの名前を、画面の呼び名にそろえる（付与状態は変えない）。
-- normalized_name は NFKC（全角コロンは半角に）→ 小文字。packages/db/src/tags.ts normalizeTagNameForCleanup と同じ結果。
UPDATE tags
   SET name = '[会員] ランク：レギュラー',
       normalized_name = CASE WHEN normalized_name IS NULL THEN NULL ELSE '[会員] ランク:レギュラー' END
 WHERE id = 'nen-tag-member-rank-basic' AND name = '[会員] ランク：会員';
