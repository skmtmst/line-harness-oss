-- Issue #686: 登録時の初回リンク発行を、同時2実行でも1本に収める。
--
-- 370 で紹介者・案件の作成は operation_id の部分UNIQUEで冪等になったが、
-- 初回リンクの発行は read-then-write のままだった。同じ operation_id で
-- 2本同時にPOSTすると、両方が「まだリンクが無い」と読んでそれぞれ発行し、
-- 紹介者1行に対してリンクが2本できる。
--
-- 発行そのものへ UNIQUE の裏付けを与え、衝突した側は既存行を回収する
-- compare-and-swap にする。
--
-- (affiliate_id, operation_id) にしているのは、汎用リンクを複数持つ既存の
-- 使い方を壊さないため。offer_id IS NULL 側を1本に固定すると、後から
-- 汎用リンクを増やす運用が塞がる。operation_id が入るのは登録操作で
-- 発行した初回リンクだけで、既存行と手動発行分は NULL のまま残る。

ALTER TABLE affiliate_links ADD COLUMN operation_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliate_links_operation_id
  ON affiliate_links(affiliate_id, operation_id)
  WHERE operation_id IS NOT NULL;
