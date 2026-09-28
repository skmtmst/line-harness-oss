-- R275: 計測サイトの停止と、手入力の広告費の取消 (#819 / #818)。
-- 足すだけの列追加。既存の行は NULL のまま「動いている / 取消していない」
-- 扱いになるので、過去の記録は変わらない。
--
-- 番号が元の表の作成 (500, 503) より小さいのは、既に当てたDBでは
-- 未適用のファイルだけが流れるため問題ない。ただし新しく作るDBでは
-- このファイルが先に流れるので、CREATE TABLE IF NOT EXISTS で表だけ先に
-- 用意してから列を足す（表が既にある環境では作成は何もしない）。
-- 定義は 500・503 と同じ。後から流れる 500・503 は IF NOT EXISTS で飛ぶ。

CREATE TABLE IF NOT EXISTS measurement_sites (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  updated_at      TEXT
);

ALTER TABLE measurement_sites ADD COLUMN stopped_at TEXT;
ALTER TABLE measurement_sites ADD COLUMN stopped_reason TEXT;

CREATE TABLE IF NOT EXISTS ad_cost_entries (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  ad_platform_id  TEXT REFERENCES ad_platforms(id) ON DELETE SET NULL,
  entry_route_id  TEXT REFERENCES entry_routes(id) ON DELETE SET NULL,
  source_label    TEXT NOT NULL,
  day             TEXT NOT NULL,
  amount_minor    INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency        TEXT NOT NULL DEFAULT 'JPY',
  source          TEXT NOT NULL CHECK (source IN ('import', 'manual')),
  imported_at     TEXT,
  created_by      TEXT REFERENCES staff_members(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

ALTER TABLE ad_cost_entries ADD COLUMN cancelled_at TEXT;
ALTER TABLE ad_cost_entries ADD COLUMN cancel_reason TEXT;
