-- 登録メディアをLINEアカウントごとに分離する。
-- 使用先が1アカウントに確定するものだけ移し、曖昧な旧データは推測しない。
ALTER TABLE media
  ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id) ON DELETE CASCADE;

-- 各複合SELECTを4項以下に分け、最後のUNIONで使用先の重複を除く。
WITH usage_a(media_id, account_id) AS (
  SELECT DISTINCT u.media_id, t.line_account_id AS account_id
    FROM media_usages u JOIN templates t ON u.ref_kind = 'template' AND t.id = u.ref_id
   WHERE t.line_account_id IS NOT NULL
  UNION
  SELECT DISTINCT u.media_id, b.line_account_id
    FROM media_usages u JOIN broadcasts b ON u.ref_kind = 'broadcast' AND b.id = u.ref_id
   WHERE b.line_account_id IS NOT NULL
  UNION
  SELECT DISTINCT u.media_id, CAST(accounts.value AS TEXT)
    FROM media_usages u
    JOIN broadcasts b ON u.ref_kind = 'broadcast' AND b.id = u.ref_id
    JOIN json_each(COALESCE(b.account_ids, '[]')) accounts
  UNION
  SELECT DISTINCT u.media_id, g.account_id
    FROM media_usages u
    JOIN rich_menu_pages p ON u.ref_kind = 'rich_menu' AND p.id = u.ref_id
    JOIN rich_menu_groups g ON g.id = p.group_id
   WHERE g.account_id IS NOT NULL
), usage_b(media_id, account_id) AS (
  SELECT DISTINCT u.media_id, s.line_account_id
    FROM media_usages u JOIN scenario_steps ss
      ON u.ref_kind = 'scenario_step' AND ss.id = u.ref_id
    JOIN scenarios s ON s.id = ss.scenario_id
   WHERE s.line_account_id IS NOT NULL
  UNION
  SELECT DISTINCT u.media_id, n.line_account_id
    FROM media_usages u JOIN nen_columns n ON u.ref_kind = 'nen_column' AND n.id = u.ref_id
   WHERE n.line_account_id IS NOT NULL
  UNION
  SELECT DISTINCT u.media_id, e.line_account_id
    FROM media_usages u JOIN events e ON u.ref_kind = 'event' AND e.id = u.ref_id
   WHERE e.line_account_id IS NOT NULL
  UNION
  SELECT DISTINCT u.media_id, CAST(accounts.value AS TEXT)
    FROM media_usages u
    JOIN events e ON u.ref_kind = 'event' AND e.id = u.ref_id
    JOIN json_each(COALESCE(e.account_ids, '[]')) accounts
), usage_c(media_id, account_id) AS (
  SELECT DISTINCT u.media_id, w.account_id
    FROM media_usages u JOIN webinars w ON u.ref_kind = 'webinar' AND w.id = u.ref_id
   WHERE w.account_id IS NOT NULL
), usage_accounts(media_id, account_id) AS (
  SELECT media_id, account_id FROM usage_a
  UNION
  SELECT media_id, account_id FROM usage_b
  UNION
  SELECT media_id, account_id FROM usage_c
)
UPDATE media
   SET line_account_id = (
     SELECT MIN(ua.account_id) FROM usage_accounts ua WHERE ua.media_id = media.id
   )
 WHERE 1 = (
   SELECT COUNT(DISTINCT ua.account_id) FROM usage_accounts ua WHERE ua.media_id = media.id
 );

UPDATE media
   SET line_account_id = (SELECT id FROM line_accounts ORDER BY id LIMIT 1)
 WHERE line_account_id IS NULL
   AND (SELECT COUNT(*) FROM line_accounts) = 1;

CREATE INDEX IF NOT EXISTS idx_media_account_created
  ON media(line_account_id, created_at DESC, id);
