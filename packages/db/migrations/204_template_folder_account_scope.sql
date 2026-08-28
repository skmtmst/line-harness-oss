-- テンプレートのフォルダをLINE公式アカウントごとに分ける。
--
-- folders は複数機能で共有しているため、既存機能を一度に壊さないよう列は
-- nullable で足す。テンプレートだけはこのマイグレーション以降、必ず
-- line_account_id を付けて読み書きする。
ALTER TABLE folders
  ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_folders_account_kind_order
  ON folders(line_account_id, kind, display_order, id);

-- これまでテンプレート一覧は category をフォルダのように表示していた。
-- 既存の分類を失わないよう、明示的な旧フォルダ名を優先し、それが無ければ
-- category をアカウント専用フォルダへ移す。既定値 general は未分類のままにする。
WITH source_folders AS (
  SELECT DISTINCT
    t.line_account_id,
    COALESCE(
      NULLIF(TRIM(old_folder.name), ''),
      CASE
        WHEN TRIM(COALESCE(t.category, '')) NOT IN ('', 'general')
          THEN TRIM(t.category)
        ELSE NULL
      END
    ) AS folder_name,
    old_folder.color AS color,
    COALESCE(old_folder.display_order, 0) AS display_order,
    COALESCE(old_folder.created_at, t.created_at) AS created_at,
    COALESCE(old_folder.updated_at, t.updated_at) AS updated_at
  FROM templates t
  LEFT JOIN folders old_folder
    ON old_folder.id = t.folder_id AND old_folder.kind = 'template'
  WHERE t.line_account_id IS NOT NULL
)
INSERT OR IGNORE INTO folders (
  id, kind, name, parent_id, display_order, color,
  created_at, updated_at, line_account_id
)
SELECT
  'template-' || LOWER(HEX(line_account_id)) || '-' || LOWER(HEX(folder_name)),
  'template',
  folder_name,
  NULL,
  display_order,
  color,
  created_at,
  updated_at,
  line_account_id
FROM source_folders
WHERE folder_name IS NOT NULL;

UPDATE templates AS template
SET folder_id = (
  SELECT scoped_folder.id
  FROM folders scoped_folder
  WHERE scoped_folder.kind = 'template'
    AND scoped_folder.line_account_id = template.line_account_id
    AND scoped_folder.name = COALESCE(
      (
        SELECT old_folder.name
        FROM folders old_folder
        WHERE old_folder.id = template.folder_id
          AND old_folder.kind = 'template'
      ),
      CASE
        WHEN TRIM(COALESCE(template.category, '')) NOT IN ('', 'general')
          THEN TRIM(template.category)
        ELSE NULL
      END
    )
  ORDER BY scoped_folder.display_order, scoped_folder.id
  LIMIT 1
)
WHERE template.line_account_id IS NOT NULL
  AND (
    EXISTS (
      SELECT 1 FROM folders old_folder
      WHERE old_folder.id = template.folder_id
        AND old_folder.kind = 'template'
    )
    OR TRIM(COALESCE(template.category, '')) NOT IN ('', 'general')
  );
