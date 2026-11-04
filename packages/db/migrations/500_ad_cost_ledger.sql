-- H: 流入の広告費の取込台帳 (#818)
-- 外部連携(ad_platforms)の暗号化された秘密を使って媒体から毎日取り込む費用と、
-- 手入力で足す費用を同じ台帳に置く。金額は最小通貨単位で保存する。

-- 465_inflow_stop_cancel.sql が「新しく作るDBではこのファイルが先に流れる」ため
-- 同じ定義を `IF NOT EXISTS` で先に用意しており、そのコメントも「後から流れる
-- 500・503 は IF NOT EXISTS で飛ぶ」と書いている。ところがここに付いていなかった
-- ので、465 を当てたあとの本番で `table ad_cost_entries already exists` で落ちた。
-- 列の定義は 465 と同じで、465 はこのあと cancelled_at と cancel_reason を足す。
CREATE TABLE IF NOT EXISTS ad_cost_entries (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  -- 取込の場合は元の外部連携、手入力なら NULL
  ad_platform_id  TEXT REFERENCES ad_platforms(id) ON DELETE SET NULL,
  -- 取込費用を帰属させる流入元(任意)。無い取込は流入元なしのまま集計だけに出す
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

-- 同じ流入先・同じ日・同じ入り口の行は1つ。取り直し・手直しは上書きになる。
-- NULL 同士は区別されるため、式つき索引で空文字にそろえて重複を防ぐ。
CREATE UNIQUE INDEX idx_ad_cost_entries_unique_day
  ON ad_cost_entries(
    line_account_id,
    COALESCE(ad_platform_id, ''),
    COALESCE(entry_route_id, ''),
    source_label,
    day
  );

CREATE INDEX idx_ad_cost_entries_account_day ON ad_cost_entries(line_account_id, day);
CREATE INDEX idx_ad_cost_entries_route ON ad_cost_entries(entry_route_id, day);

-- 媒体ごとの取込結果。取れなかった日も残すので「最後に取れたのはいつか」と
-- 「今日は取れなかった」が区別できる
CREATE TABLE ad_cost_import_runs (
  id             TEXT PRIMARY KEY,
  ad_platform_id TEXT NOT NULL REFERENCES ad_platforms(id) ON DELETE CASCADE,
  day            TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  error_message  TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (ad_platform_id, day)
);
