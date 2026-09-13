-- 予約後の通知・外部反映を、予約詳細と登録完了画面へ事実として返す。
CREATE TABLE booking_operation_runs (
  id              TEXT PRIMARY KEY,
  booking_id      TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN (
                    'confirmation_line', 'google_calendar', 'conversion',
                    'mileage', 'automation'
                  )),
  status          TEXT NOT NULL CHECK (status IN (
                    'queued', 'succeeded', 'skipped', 'retry_wait',
                    'permanent_failed', 'cancelled'
                  )),
  scheduled_at    TEXT,
  completed_at    TEXT,
  opened_at       TEXT,
  result_json     TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(result_json)),
  error_code      TEXT,
  idempotency_key TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
  UNIQUE (line_account_id, idempotency_key)
);

CREATE INDEX idx_booking_operation_runs_booking
  ON booking_operation_runs(line_account_id, booking_id, created_at DESC);

CREATE INDEX idx_booking_operation_runs_status
  ON booking_operation_runs(status, scheduled_at);
