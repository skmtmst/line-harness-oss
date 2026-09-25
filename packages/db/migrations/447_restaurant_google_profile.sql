-- 飲食店向け「Googleビジネス」第2段（プロフィール・営業時間・変更履歴）。
-- 第1段（446）の表は変更しない。rt_google_write_log は kind の CHECK 制約が第1段の種類だけなので、
-- 第2段の記録は新しい rt_google_changes に残す（表の作り直しを避けるため）。

-- 取得したプロフィールの写し（店舗1行）。profile_json は services/google-business-profile.ts の GoogleProfile。
-- 個人情報は含まない（店舗の公開情報のみ）。
CREATE TABLE IF NOT EXISTS rt_google_profiles (
  store_id TEXT PRIMARY KEY REFERENCES rt_stores(id) ON DELETE CASCADE,
  location_name TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Googleへの変更（案 → 送信 → 反映）。営業時間・プロフィール項目・写真を1つの表で扱い、GB-17 変更履歴の元にする。
--   kind: special_hours（1日だけ）/ regular_hours（毎週）/ profile（店舗名・住所・電話・サイト・紹介文）/ photo（写真の追加・削除）
--   source: shortcut（今日を休みに 等）/ text（かんたん入力）/ calendar / weekly / profile_edit / photo
--   status: draft（確認前）/ pending_confirm（送信結果が不明）/ accepted（Googleが受理）/ applied（再取得で一致）
--           / failed / conflict（別の担当者が先に変更）/ cancelled
--   before_json / after_json は送信ペイロードの元になる画面上の値（営業時間は対象日・曜日だけ、送信時は全体を組み立てる）。
--   base_fingerprint は変更案を作ったときのプロフィール指紋。送信直前に最新と比べ、違えば送らない。
CREATE TABLE IF NOT EXISTS rt_google_changes (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('special_hours', 'regular_hours', 'profile', 'photo')),
  source TEXT NOT NULL CHECK (source IN ('shortcut', 'text', 'calendar', 'weekly', 'profile_edit', 'photo')),
  summary TEXT NOT NULL,
  target_json TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT NOT NULL,
  input_text TEXT,
  reservation_impact_count INTEGER NOT NULL DEFAULT 0,
  base_fingerprint TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_confirm', 'accepted', 'applied', 'failed', 'conflict', 'cancelled')),
  staff_id TEXT,
  staff_name TEXT,
  request_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  applied_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rt_google_changes_store ON rt_google_changes(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rt_google_changes_status ON rt_google_changes(store_id, status);
