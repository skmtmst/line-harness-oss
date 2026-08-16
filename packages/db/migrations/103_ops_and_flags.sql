-- 運用・権限・配信の細かい設定。

-- ログイン履歴。個人情報項目を開いたことも残す（個人情報保護法上の利用記録）。
CREATE TABLE IF NOT EXISTS login_audit (
  id            TEXT PRIMARY KEY,
  admin_user_id TEXT,
  action        TEXT NOT NULL CHECK (action IN ('login','logout','fail','view_personal','export')),
  screen        TEXT,
  ip            TEXT,
  user_agent    TEXT,
  result        TEXT NOT NULL DEFAULT 'ok',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_login_audit_user ON login_audit(admin_user_id, created_at);

-- 二要素認証の有効/無効。認証そのものの実装はこの列だけでは終わらない。
ALTER TABLE admin_users ADD COLUMN two_factor_enabled INTEGER NOT NULL DEFAULT 0;

-- 自動応答の評価順。小さいほど先に見る。同じ値なら created_at 順。
-- 「上から順に見て最初に当てはまった1つだけが動く」を人が決められるようにする。
ALTER TABLE auto_replies ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
-- 対象にするメッセージ種別（text / image / sticker など）。NULL なら全部。
ALTER TABLE auto_replies ADD COLUMN message_kinds_json TEXT
  CHECK (message_kinds_json IS NULL OR json_valid(message_kinds_json));
-- 友だちの条件で絞る。形は saved_searches.conditions_json と同じ。
ALTER TABLE auto_replies ADD COLUMN friend_conditions_json TEXT
  CHECK (friend_conditions_json IS NULL OR json_valid(friend_conditions_json));

-- 同じシナリオに重ねて登録できるか。既定0は従来どおり「1人1シナリオ」。
ALTER TABLE scenarios ADD COLUMN allow_concurrent INTEGER NOT NULL DEFAULT 0;

-- 一斉配信を何分かけて散らすか。0 は従来どおり一気に送る。
ALTER TABLE broadcasts ADD COLUMN stealth_spread_minutes INTEGER NOT NULL DEFAULT 0;
