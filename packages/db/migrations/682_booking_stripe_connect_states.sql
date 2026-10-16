-- B-324 / API組3: 681は組4。予約用Stripe Connectの短命・一回限りの状態。
-- state/ログインセッションはSHA-256のみ。認可コード・鍵・OAuthトークンは保存しない。
CREATE TABLE booking_stripe_connect_states (
  line_account_id TEXT PRIMARY KEY REFERENCES line_accounts(id) ON DELETE CASCADE,
  state_hash TEXT NOT NULL UNIQUE CHECK(length(state_hash)=64),
  staff_id TEXT NOT NULL,
  session_hash TEXT NOT NULL CHECK(length(session_hash)=64),
  status TEXT NOT NULL CHECK(status IN ('pending','exchanging','disconnecting','finished','failed')),
  expires_at TEXT NOT NULL CHECK(julianday(expires_at) IS NOT NULL),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
