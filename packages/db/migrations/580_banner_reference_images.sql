-- 566: バナー生成の参照画像を最大3枚にする（承認済み ★BG-C `cOgWE`）
-- 画像ごとに使い方（土台にする／素材を一部使う／雰囲気を参考にする）を持つため、
-- 1枚組の reference_image_id / reference_mode に加えて JSON の一覧を置く。
-- 既にある生成は古い2列をそのまま読むので、この列は NULL のままでよい。
ALTER TABLE banner_generations ADD COLUMN reference_images TEXT;
