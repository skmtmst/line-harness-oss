-- V6 機能6: 一斉配信の途中下書き、配信後アクション、保存条件、リンク別集計。
--
-- 既存の配信行と送信処理は残し、画面が未完成の途中状態を安全に保存できる
-- 追加列と、アカウント単位の補助台帳だけを追加する。

ALTER TABLE broadcasts ADD COLUMN internal_memo TEXT;
ALTER TABLE broadcasts ADD COLUMN draft_step TEXT
  CHECK (draft_step IS NULL OR draft_step IN ('basic', 'audience', 'message', 'schedule', 'confirm'));
ALTER TABLE broadcasts ADD COLUMN draft_payload_json TEXT
  CHECK (draft_payload_json IS NULL OR json_valid(draft_payload_json));
ALTER TABLE broadcasts ADD COLUMN message_options_json TEXT
  CHECK (message_options_json IS NULL OR json_valid(message_options_json));
ALTER TABLE broadcasts ADD COLUMN after_action_version_id TEXT
  REFERENCES common_action_versions(id) ON DELETE RESTRICT;
ALTER TABLE broadcasts ADD COLUMN lock_version INTEGER NOT NULL DEFAULT 1
  CHECK (lock_version > 0);

CREATE TABLE IF NOT EXISTS broadcast_saved_views (
  id               TEXT PRIMARY KEY,
  line_account_id  TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  filters_json     TEXT NOT NULL DEFAULT '{}'
                   CHECK (json_valid(filters_json)),
  sort_key         TEXT NOT NULL DEFAULT 'newest'
                   CHECK (sort_key IN ('newest', 'oldest', 'title', 'scheduled')),
  page_size        INTEGER NOT NULL DEFAULT 20
                   CHECK (page_size IN (20, 50, 100)),
  created_by       TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  version          INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (line_account_id, name)
);

CREATE INDEX IF NOT EXISTS idx_broadcast_saved_views_account_updated
  ON broadcast_saved_views(line_account_id, updated_at DESC, id);

-- 自動短縮URLを配信へ結び、別の配信で同じURLを使ってもクリックを混ぜない。
CREATE TABLE IF NOT EXISTS broadcast_tracked_links (
  broadcast_id     TEXT NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  tracked_link_id  TEXT NOT NULL REFERENCES tracked_links(id) ON DELETE RESTRICT,
  label            TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  PRIMARY KEY (broadcast_id, tracked_link_id)
);

CREATE INDEX IF NOT EXISTS idx_broadcast_tracked_links_link
  ON broadcast_tracked_links(tracked_link_id, broadcast_id);
