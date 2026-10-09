-- オーナー承認: 2026-10-09。旧メモの列は控えとして残し、以後は chats.notes だけを使う。
-- 既存の受信箱のメモを残して追記する。移行済みのまとまりは再度足さない。
-- 新しい会話にも友だちの所属を引き継ぎ、既存の担当・状態・受信日時は変えない。
WITH legacy_memos AS (
  SELECT f.id AS friend_id, f.line_account_id, f.private_memo,
    '【旧「個別メモ」から移行】' || char(10) || f.private_memo || char(10) ||
      '【移行したメモここまで】' AS migrated_note
  FROM friends f
  WHERE COALESCE(TRIM(f.private_memo, char(9) || char(10) || char(13) || ' '), '') != ''
)
INSERT INTO chats (id, friend_id, line_account_id, notes, created_at, updated_at)
SELECT lower(hex(randomblob(16))), friend_id, line_account_id, migrated_note,
  strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'),
  strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
FROM legacy_memos
WHERE NOT EXISTS (
  SELECT 1 FROM chats c
  WHERE c.friend_id = legacy_memos.friend_id
    AND instr(COALESCE(c.notes, ''), legacy_memos.migrated_note) > 0
)
ON CONFLICT(friend_id) DO UPDATE SET
  notes = CASE
    WHEN COALESCE(TRIM(chats.notes), '') = '' OR
      chats.notes = (SELECT private_memo FROM friends WHERE id = excluded.friend_id)
      THEN excluded.notes
    ELSE chats.notes || char(10) || char(10) || '──────────' || char(10) || excluded.notes
  END,
  updated_at = excluded.updated_at,
  revision = chats.revision + 1;
