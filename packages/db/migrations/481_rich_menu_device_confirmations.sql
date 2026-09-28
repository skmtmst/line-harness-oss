-- O(公開前の確認): スマートフォン実機で見た記録。管理画面の
-- プレビューだけでは公開できない門番。
-- 下書きが変わる（fingerprint が変わる）と確認は無効になり、
-- 公開の前に新しい中身でもう一度「実機で見た」を押す必要がある。

CREATE TABLE IF NOT EXISTS rich_menu_device_confirmations (
  id                     TEXT PRIMARY KEY,
  group_id               TEXT NOT NULL REFERENCES rich_menu_groups(id) ON DELETE CASCADE,
  -- 確認した時点の下書きの fingerprint。公開時は今の下書きと突き合わせる。
  definition_fingerprint TEXT NOT NULL,
  version_id             TEXT REFERENCES rich_menu_versions(id) ON DELETE SET NULL,
  staff_id               TEXT NOT NULL,
  confirmed_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rich_menu_device_confirmations_group_fp_staff
  ON rich_menu_device_confirmations(group_id, definition_fingerprint, staff_id);
CREATE INDEX IF NOT EXISTS idx_rich_menu_device_confirmations_group
  ON rich_menu_device_confirmations(group_id, confirmed_at DESC);
