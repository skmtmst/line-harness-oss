-- 一斉配信でも、シナリオと同じ種別を送れるようにする。
--
-- これまで一斉配信が持てた種別は text / image / flex の3つだけだった。
-- シナリオは 137〜141 で位置情報・動画・音声・スタンプ・カルーセルまで
-- 送れるようになっているのに、一斉配信だけ取り残されていた。
--
-- 画面には種別の選択肢が並んでいたが、選ぶと `bubbleLegacyMessage` が
-- 「テキストに JSON を入れたもの」に落とすので、**中身の JSON がそのまま
-- 相手のトークに届く**。送って初めて分かる壊れ方をするので、選べない
-- ようにして止めてある（#181）。この作り直しでその蓋を外す。
--
-- SQLite は CHECK を後から変えられないので、表を作り直す。
CREATE TABLE broadcasts_new (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  message_type       TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'flex', 'location', 'video', 'audio', 'sticker', 'carousel')),
  message_content    TEXT NOT NULL,
  target_type        TEXT NOT NULL CHECK (target_type IN ('all', 'tag', 'segment', 'multi-account-dedup')) DEFAULT 'all',
  target_tag_id      TEXT REFERENCES tags (id) ON DELETE SET NULL,
  status             TEXT NOT NULL CHECK (status IN ('draft', 'scheduled', 'sending', 'sent')) DEFAULT 'draft',
  scheduled_at       TEXT,
  sent_at            TEXT,
  total_count        INTEGER NOT NULL DEFAULT 0,
  success_count      INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  line_account_id    TEXT,
  alt_text           TEXT,
  line_request_id    TEXT,
  aggregation_unit   TEXT,
  batch_offset       INTEGER NOT NULL DEFAULT 0,
  segment_conditions TEXT,
  account_ids        TEXT CHECK (account_ids IS NULL OR json_valid(account_ids)),
  dedup_priority     TEXT CHECK (dedup_priority IS NULL OR json_valid(dedup_priority)),
  failed_account_ids TEXT CHECK (failed_account_ids IS NULL OR json_valid(failed_account_ids)),
  dedup_progress     TEXT,
  batch_lock_at      TEXT,
  track_links        INTEGER NOT NULL DEFAULT 1,
  message_bubbles_json TEXT CHECK (message_bubbles_json IS NULL OR json_valid(message_bubbles_json)),
  stealth_spread_minutes INTEGER NOT NULL DEFAULT 0
);
