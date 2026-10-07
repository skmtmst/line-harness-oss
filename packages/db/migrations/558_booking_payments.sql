-- 予約の支払い（決済サービスを差し替えられる作り）。
-- 予約と金額の記録はここに置き、決済サービスごとの鍵は置かない
-- （鍵は Worker の秘密値から読む）。適用は承認後に行うこと。
CREATE TABLE booking_payment_configs (
  line_account_id TEXT PRIMARY KEY REFERENCES line_accounts(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'none'
    CHECK (mode IN ('none', 'onsite', 'online')),
  -- プロバイダ名は差し替えのために絞らない。新しいサービスは登録表へ足すだけ。
  provider TEXT NOT NULL DEFAULT 'none',
  hold_minutes INTEGER NOT NULL DEFAULT 30 CHECK (hold_minutes BETWEEN 5 AND 1440),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- メニューごとの上書き。行がなければ店の既定を使う。
CREATE TABLE booking_payment_menu_settings (
  menu_id TEXT PRIMARY KEY REFERENCES menus(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('none', 'onsite', 'online')),
  provider TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 支払いの記録。予約・金額・状態・相手側ID・重複防止の鍵を持つ。
CREATE TABLE booking_payments (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'JPY',
  status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (status IN ('unpaid', 'pending', 'paid', 'failed', 'refunded', 'expired')),
  provider TEXT NOT NULL,
  provider_payment_id TEXT,
  idempotency_key TEXT NOT NULL,
  hold_until TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (line_account_id, idempotency_key)
);
CREATE INDEX idx_booking_payments_booking
  ON booking_payments(booking_id, created_at DESC);
CREATE INDEX idx_booking_payments_status_hold
  ON booking_payments(line_account_id, status, hold_until);
