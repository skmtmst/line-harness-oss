-- 手動公開の押し直しを、予約公開と同じく account + Idempotency-Key 単位で固定する。
-- shell journal を残すことで、LINEメニューを作成済みの途中失敗は再作成せず公開を再開できる。

CREATE TABLE IF NOT EXISTS rich_menu_manual_publish_requests (
  id                    TEXT PRIMARY KEY,
  group_id              TEXT NOT NULL REFERENCES rich_menu_groups(id) ON DELETE CASCADE,
  account_id            TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  definition_snapshot   TEXT NOT NULL,
  request_fingerprint   TEXT NOT NULL,
  idempotency_key       TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  result_json           TEXT,
  last_error_code       TEXT,
  requested_by_staff_id TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  UNIQUE (account_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_rich_menu_manual_publish_requests_group
  ON rich_menu_manual_publish_requests (group_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rich_menu_manual_publish_shells (
  request_id       TEXT NOT NULL REFERENCES rich_menu_manual_publish_requests(id) ON DELETE CASCADE,
  page_id          TEXT NOT NULL,
  order_index      INTEGER NOT NULL,
  new_richmenu_id  TEXT NOT NULL,
  old_richmenu_id  TEXT,
  created_at       TEXT NOT NULL,
  PRIMARY KEY (request_id, page_id)
);
