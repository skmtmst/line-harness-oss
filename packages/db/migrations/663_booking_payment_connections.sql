-- B-324: API組3。接続の事実だけを保存し、鍵・OAuthトークンは保存しない。
CREATE TABLE booking_payment_connections (
  line_account_id TEXT PRIMARY KEY REFERENCES line_accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider='stripe'),
  provider_account_id TEXT NOT NULL CHECK(length(provider_account_id) BETWEEN 6 AND 255),
  test_mode INTEGER NOT NULL DEFAULT 1 CHECK(test_mode IN (0,1)),
  connected_at TEXT NOT NULL CHECK(julianday(connected_at) IS NOT NULL),
  disconnected_at TEXT CHECK(disconnected_at IS NULL OR julianday(disconnected_at) IS NOT NULL),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
