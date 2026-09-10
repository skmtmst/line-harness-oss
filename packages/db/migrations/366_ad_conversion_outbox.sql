-- 広告送信の到達可能な待ち行列(#638)。
-- fireEventからsendAdConversionsへ渡る途中で落ちると送信要求自体が残らず、
-- 失敗分を取り直す手段が送信記録にしかなかったため、要求を先に残す。
-- 取り出し側は同じ冪等キーで送るため、送信記録の重複排除が効く。
-- 取り出し回数に上限を付け、無限に送り続けない。内容不一致の行は人の確認が必要。
CREATE TABLE ad_conversion_outbox (
  id                TEXT PRIMARY KEY,
  ad_platform_id    TEXT NOT NULL REFERENCES ad_platforms(id) ON DELETE CASCADE,
  friend_id         TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  line_account_id   TEXT REFERENCES line_accounts(id) ON DELETE SET NULL,
  event_name        TEXT NOT NULL,
  event_value       REAL,
  currency          TEXT NOT NULL DEFAULT 'JPY',
  amount_in_minor_unit INTEGER NOT NULL DEFAULT 0,
  idempotency_key   TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempt_count     INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at   TEXT,
  lease_token       TEXT,
  provider_event_id TEXT,
  last_error        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (ad_platform_id, friend_id, event_name, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_ad_conversion_outbox_due
  ON ad_conversion_outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_ad_conversion_outbox_friend
  ON ad_conversion_outbox(friend_id);
