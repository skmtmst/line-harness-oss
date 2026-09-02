-- サイトスクリプトとファネル分析。

-- 自社サイトの訪問者。id は1st party cookie に入れる値。
-- 友だちと突き合わせられたら friend_id が埋まる。
CREATE TABLE IF NOT EXISTS site_visitors (
  id            TEXT PRIMARY KEY,
  friend_id     TEXT REFERENCES friends(id) ON DELETE SET NULL,
  first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  last_seen_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  linked_at     TEXT,
  linked_by     TEXT CHECK (linked_by IS NULL OR linked_by IN ('entry_route','liff','form','manual'))
);
CREATE INDEX IF NOT EXISTS idx_site_visitors_friend ON site_visitors(friend_id);

-- 個人情報を載せない。path のクエリ文字列はサーバ側で落とす
-- （メールアドレス等がURLに入る事故を防ぐ）。
CREATE TABLE IF NOT EXISTS site_events (
  id          TEXT PRIMARY KEY,
  visitor_id  TEXT NOT NULL REFERENCES site_visitors(id) ON DELETE CASCADE,
  friend_id   TEXT REFERENCES friends(id) ON DELETE SET NULL,
  event_type  TEXT NOT NULL CHECK (event_type IN (
                'page_view','click','scroll_depth','custom','purchase')),
  path        TEXT,
  label       TEXT,
  value_num   INTEGER,
  referrer    TEXT,
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_site_events_friend ON site_events(friend_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_site_events_path ON site_events(path, occurred_at);

CREATE TABLE IF NOT EXISTS funnels (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  segment_json TEXT CHECK (segment_json IS NULL OR json_valid(segment_json)),
  -- 何日以内に次の段へ進んだものを数えるか。
  window_days  INTEGER NOT NULL DEFAULT 30,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);

CREATE TABLE IF NOT EXISTS funnel_steps (
  id         TEXT PRIMARY KEY,
  funnel_id  TEXT NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  label      TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN (
               'tag','field','form','site_event','purchase','link_click','conversion')),
  match_json TEXT NOT NULL CHECK (json_valid(match_json)),
  UNIQUE (funnel_id, step_order)
);
