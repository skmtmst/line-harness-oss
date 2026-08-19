-- migration-policy: table-rebuild
--
-- 古い表を落として、新しい表を同じ名前にする。
--
-- **落とすのと改名するのを1つのファイルにまとめてある。** 分けると、
-- 落としたあと改名する前に止まったときに `broadcasts` が存在しない状態で
-- 残る。当てる仕組みはファイルごとに `wrangler d1 execute --file` を呼ぶので、
-- ファイルの境目がそのまま「表が無い時間」になる。同じファイルなら1回の
-- 呼び出しで済み、その隙間が消える。
DROP TABLE broadcasts;
ALTER TABLE broadcasts_new RENAME TO broadcasts;
