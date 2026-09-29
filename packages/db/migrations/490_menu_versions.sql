-- 490: 予約メニューの版履歴 (T: 予約の設定の版と予約の写し)。
-- 保存のたびに1行足す。前の版は変えない（追記だけ。UPDATE・DELETE しない）。
-- 「この版に戻す」はこの表の行を変えず、その中身で新しい版を作る。
CREATE TABLE IF NOT EXISTS menu_versions (
  id TEXT PRIMARY KEY,
  menu_id TEXT NOT NULL
    REFERENCES menus(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  name TEXT NOT NULL,
  category_label TEXT,
  description TEXT,
  duration_minutes INTEGER NOT NULL,
  buffer_after_minutes INTEGER NOT NULL DEFAULT 0,
  base_price INTEGER NOT NULL,
  price_mode TEXT NOT NULL DEFAULT 'fixed'
    CHECK (price_mode IN ('fixed', 'free', 'inquiry')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  -- 受付条件の上書き（booking_window_days / cutoff_hours_before /
  -- cancel_deadline_hours_before / intake_question / concurrent_capacity）。
  -- 空は「店舗の決まりを使う」。
  rules_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(rules_json)),
  created_by_staff_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (menu_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_menu_versions_menu
  ON menu_versions (menu_id, version_number DESC);

-- いまあるメニューは、いまの中身をその版番号で1行残す。
-- 版を持たないまま保存すると履歴が欠けるので、ここで埋める。
INSERT OR IGNORE INTO menu_versions
  (id, menu_id, version_number, name, category_label, description,
   duration_minutes, buffer_after_minutes, base_price, price_mode,
   sort_order, is_active, rules_json, created_at)
SELECT lower(hex(randomblob(16))), id, version, name, category_label, description,
   duration_minutes, buffer_after_minutes, base_price, price_mode,
   sort_order, is_active,
   json_object(
     'booking_window_days', booking_window_days,
     'cutoff_hours_before', cutoff_hours_before,
     'cancel_deadline_hours_before', cancel_deadline_hours_before,
     'intake_question', intake_question,
     'concurrent_capacity', concurrent_capacity
   ),
   updated_at
  FROM menus;
