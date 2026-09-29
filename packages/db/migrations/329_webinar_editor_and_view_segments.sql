-- 329: V6 ウェビナー編集・公開版・実視聴区間の契約。
-- 公開済みの内容を直接上書きせず、編集設定の版と公開時のスナップショットを残す。

CREATE TABLE IF NOT EXISTS webinar_editor_settings (
  webinar_id                 TEXT PRIMARY KEY REFERENCES webinars(id) ON DELETE CASCADE,
  version                    INTEGER NOT NULL DEFAULT 1,
  delivery_kind              TEXT NOT NULL DEFAULT 'on_demand'
                             CHECK (delivery_kind IN ('on_demand', 'scheduled', 'external')),
  viewing_condition_json     TEXT NOT NULL DEFAULT '{"kind":"registered","label":"申込者向け"}',
  public_description         TEXT NOT NULL DEFAULT '',
  registration_form_id       TEXT REFERENCES forms(id) ON DELETE SET NULL,
  notification_messages_json TEXT NOT NULL DEFAULT '{}',
  notification_test_json     TEXT,
  action_template_body       TEXT NOT NULL DEFAULT '',
  missing_result_policy      TEXT NOT NULL DEFAULT 'escalate'
                             CHECK (missing_result_policy IN ('escalate', 'retry_next_day')),
  public_page_test_json       TEXT,
  published_version          INTEGER,
  published_at               TEXT,
  created_at                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webinar_versions (
  id            TEXT PRIMARY KEY,
  webinar_id    TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  state         TEXT NOT NULL DEFAULT 'draft'
                CHECK (state IN ('draft', 'published', 'superseded')),
  snapshot_json TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  published_at  TEXT,
  UNIQUE (webinar_id, version)
);

CREATE INDEX IF NOT EXISTS idx_webinar_versions_state
  ON webinar_versions (webinar_id, state, version DESC);

CREATE TABLE IF NOT EXISTS webinar_view_segments (
  id               TEXT PRIMARY KEY,
  webinar_id       TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  friend_id        TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  session_start_at INTEGER NOT NULL,
  start_seconds    INTEGER NOT NULL CHECK (start_seconds >= 0),
  end_seconds      INTEGER NOT NULL CHECK (end_seconds > start_seconds),
  received_at      TEXT NOT NULL,
  idempotency_key  TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_webinar_view_segments_coverage
  ON webinar_view_segments (webinar_id, start_seconds, end_seconds);
