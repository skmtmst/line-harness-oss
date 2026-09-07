-- ウェビナーのフォルダをLINE公式アカウント単位で保存する。
-- ほかの機能のフォルダ契約は変えず、ウェビナーだけ所有先を必須にする。
ALTER TABLE folders ADD COLUMN account_id TEXT REFERENCES line_accounts(id) ON DELETE CASCADE;

-- 既存データは、そのフォルダを使っている最初のアカウントへ帰属させる。
-- 同じフォルダを複数アカウントで共有していた場合は複製して付け替える。
UPDATE folders
   SET account_id = (
     SELECT MIN(w.account_id)
       FROM webinars w
      WHERE w.folder_id = folders.id
   )
 WHERE kind = 'webinar';

INSERT INTO folders (
  id, kind, name, parent_id, display_order, color, account_id, created_at, updated_at
)
SELECT f.id || ':account:' || w.account_id,
       f.kind,
       f.name,
       NULL,
       f.display_order,
       f.color,
       w.account_id,
       f.created_at,
       f.updated_at
  FROM folders f
  JOIN webinars w ON w.folder_id = f.id
 WHERE f.kind = 'webinar'
   AND f.account_id IS NOT NULL
   AND w.account_id <> f.account_id
 GROUP BY f.id, w.account_id;

UPDATE webinars
   SET folder_id = folder_id || ':account:' || account_id
 WHERE folder_id IS NOT NULL
   AND EXISTS (
     SELECT 1
       FROM folders f
      WHERE f.id = webinars.folder_id
        AND f.kind = 'webinar'
        AND f.account_id <> webinars.account_id
   );

CREATE INDEX IF NOT EXISTS idx_folders_webinar_account_order_333
  ON folders(kind, account_id, display_order, name);
