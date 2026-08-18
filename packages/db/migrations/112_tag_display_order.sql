-- タグの並び順。
--
-- 設計（V2 3-1）は各行の左に掴む印があり、上下に入れ替えられる。よく使う
-- タグを上に置くための操作で、支店ごと・季節ごとに順番を変える運用を想定
-- している。並びを覚える列が無く、実装では「付与人数が多い順」など決まった
-- 並びしか出せなかった。
--
-- support_marks（対応マーク）と folders は 100 / 099 で同じ列を持っている。
-- 名前も既定値もそろえる。
--
-- 既定は 0。全部 0 のときは、これまでどおり付与人数や名前で並ぶ（並び替えの
-- クエリが display_order のあとに元の並びを見るため）。入れ替えたものだけが
-- 前に出る。
ALTER TABLE tags ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;

-- 一覧は「分類ごとに並び順で」出す。分類を絞った状態での並び替えが主な操作。
CREATE INDEX IF NOT EXISTS idx_tags_order ON tags (folder_id, display_order);
