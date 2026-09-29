-- 429: 運営からのお知らせ配信 ★V6 37-7 と、契約者専用LINE（決定 2026-09-18 案A）
--
-- 運営（musubo 提供元）が契約先の権限者へ知らせを送る。送り方は 3 つ:
--   line   … 契約者専用LINE（運営会社のアカウントとして登録した公式アカウント）へ push
--   screen … 統括の管理画面の上部に出す（既読で消える）
--   email  … 登録メールアドレスへ送る
-- 契約者専用LINE に使うアカウントは platform_settings('notice_line_account_id') で指定する。
-- 権限者と LINE の友だちの紐づけは、画面に出す 6 桁の確認コードを LINE で送って行う。

CREATE TABLE IF NOT EXISTS platform_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_by  TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE IF NOT EXISTS platform_announcements (
  id                   TEXT PRIMARY KEY,
  subject              TEXT NOT NULL,
  body                 TEXT NOT NULL,
  audience_kind        TEXT NOT NULL DEFAULT 'all' CHECK (audience_kind IN ('all', 'plan', 'tenants')),
  -- プラン別のときのプラン（JSON 配列: light/standard/pro/trial）、契約先を選ぶときの tenants.id（JSON 配列）
  audience_plans       TEXT NOT NULL DEFAULT '[]',
  audience_tenant_ids  TEXT NOT NULL DEFAULT '[]',
  -- 送り方（JSON 配列: line / screen / email）
  channels             TEXT NOT NULL DEFAULT '["screen"]',
  status               TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed')),
  -- 公開日時（JST の ISO）。NULL の下書きは予約しない。scheduled はこの時刻以降に cron が送る
  publish_at           TEXT,
  sent_at              TEXT,
  recipients_total     INTEGER NOT NULL DEFAULT 0,
  line_sent            INTEGER NOT NULL DEFAULT 0,
  line_failed          INTEGER NOT NULL DEFAULT 0,
  mail_sent            INTEGER NOT NULL DEFAULT 0,
  mail_failed          INTEGER NOT NULL DEFAULT 0,
  last_error           TEXT,
  created_by_staff_id  TEXT NOT NULL,
  created_by_name      TEXT NOT NULL DEFAULT '',
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_platform_announcements_status
  ON platform_announcements(status, publish_at);

-- 宛先ごとの届き方。screen_read_at が入ると管理画面の表示から消える。
CREATE TABLE IF NOT EXISTS platform_announcement_recipients (
  id               TEXT PRIMARY KEY,
  announcement_id  TEXT NOT NULL REFERENCES platform_announcements(id) ON DELETE CASCADE,
  tenant_id        TEXT NOT NULL,
  staff_id         TEXT NOT NULL,
  channels         TEXT NOT NULL DEFAULT '[]',
  line_sent_at     TEXT,
  line_error       TEXT,
  mail_sent_at     TEXT,
  mail_error       TEXT,
  screen_read_at   TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE(announcement_id, staff_id)
);
CREATE INDEX IF NOT EXISTS idx_platform_announcement_recipients_staff
  ON platform_announcement_recipients(staff_id, screen_read_at);

-- 権限者と契約者専用LINEの友だちの紐づけ
ALTER TABLE staff_members ADD COLUMN notice_friend_id TEXT;
ALTER TABLE staff_members ADD COLUMN notice_linked_at TEXT;

-- 紐づけの確認コード（6 桁・24 時間）。画面に出し、LINE で送ってもらう。
CREATE TABLE IF NOT EXISTS staff_line_link_codes (
  code        TEXT PRIMARY KEY,
  staff_id    TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_staff_line_link_codes_staff
  ON staff_line_link_codes(staff_id, expires_at);
