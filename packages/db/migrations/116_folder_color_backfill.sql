-- 色を付けていないフォルダに色を入れる。
--
-- 色は 115 で folders に足したので、それより前からあるフォルダは全部 null。
-- 画面はフォルダの色をそのまま中のタグの印に出すため、null のままだと
-- そのフォルダのタグが全部灰色になり、一覧で区別に使えない。
--
-- 2段階で入れる。
--
-- 1. 中に入っているタグに色が残っていれば、いちばん多い色をフォルダに移す。
--    115 以前はタグ1枚ずつに色を持たせていて、その色で見分けていた運用が
--    あるため、見た目を変えずに引き継げる。
-- 2. それでも決まらないフォルダには、並び順から決まる色を入れる。
--    画面の FOLDER_COLORS と同じ8色・同じ並び。ランダムにすると
--    実行するたびに色が変わり、検証と本番で違う色になる。
--
-- kind='tag' だけを対象にする。ほかの種類のフォルダは、色を出す画面が
-- まだ無い。出すようになった時点で、その画面に合わせて入れる。

UPDATE folders
   SET color = (
         SELECT t.color
           FROM tags t
          WHERE t.folder_id = folders.id
            AND t.color IS NOT NULL
            AND t.color <> ''
          GROUP BY t.color
          ORDER BY COUNT(*) DESC, t.color ASC
          LIMIT 1
       )
 WHERE kind = 'tag'
   AND (color IS NULL OR color = '')
   AND EXISTS (
         SELECT 1 FROM tags t2
          WHERE t2.folder_id = folders.id
            AND t2.color IS NOT NULL
            AND t2.color <> ''
       );

UPDATE folders
   SET color = CASE display_order % 8
                 WHEN 0 THEN '#3B82F6'
                 WHEN 1 THEN '#10B981'
                 WHEN 2 THEN '#F59E0B'
                 WHEN 3 THEN '#EF4444'
                 WHEN 4 THEN '#8B5CF6'
                 WHEN 5 THEN '#EC4899'
                 WHEN 6 THEN '#06B6D4'
                 ELSE '#6B7280'
               END
 WHERE kind = 'tag'
   AND (color IS NULL OR color = '');
