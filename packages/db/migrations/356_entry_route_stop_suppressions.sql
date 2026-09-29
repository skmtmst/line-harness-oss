-- N-244: 停止した流入経路の抑止台帳。LIFF/OAuth側の停止試行(refは停止済み)を
-- 友だち追加の follow webhook へ引き継ぎ、停止由来の受付・帰属・タグ/
-- シナリオ開始を止める。候補・friends.ref_code が無い別followでも、同一
-- 利用者(LINEアカウント+ユーザー)の直近の停止試行を見て自然流入扱いにしない。
-- 行は有効期限(通常10分)で自然に失効し、消費しない(Webhook再送でも抑止を保つ)。
CREATE TABLE IF NOT EXISTS entry_route_stop_suppressions (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  line_user_id    TEXT NOT NULL,
  friend_id       TEXT REFERENCES friends(id) ON DELETE SET NULL,
  ref_code        TEXT NOT NULL,
  source          TEXT NOT NULL,
  occurred_at     TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_stop_suppressions_lookup
  ON entry_route_stop_suppressions (line_account_id, line_user_id, expires_at);
