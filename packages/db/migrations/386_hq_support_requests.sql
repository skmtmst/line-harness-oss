-- 統括から運営（musubo 提供元）へのお問い合わせ。
--
-- 既存の support（受信箱）は店舗のお客様からの問い合わせを扱うもので、
-- 統括の利用者が運営へ送る「使い方・不具合・料金の相談」とは相手も向きも違う。
-- 混ぜると店舗の受信箱に運営宛ての文が並ぶので、別の表にする。
--
-- 送信するとこの表に残り、運営の連絡先へメールで知らせ、送信者には控えを送る。
-- 状態は当面 open のまま。運営側の返信画面は後続。

CREATE TABLE IF NOT EXISTS hq_support_requests (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id),
  staff_id         TEXT,
  staff_name       TEXT NOT NULL DEFAULT '',
  staff_email      TEXT,
  kind             TEXT NOT NULL CHECK (kind IN ('usage', 'bug', 'billing', 'feature', 'other')),
  subject          TEXT NOT NULL,
  body             TEXT NOT NULL,
  line_account_id  TEXT REFERENCES line_accounts(id) ON DELETE SET NULL,
  -- 添付した画像の R2 キー（JSON 配列）。実体は IMAGES バケットの support/ 配下。
  attachment_keys  TEXT NOT NULL DEFAULT '[]',
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
  notified_at      TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_hq_support_requests_tenant
  ON hq_support_requests(tenant_id, created_at DESC);
