-- バナー生成の「参照画像」（★V6 35-2 の参照画像欄、35-2-B）。
--
-- 生成の条件に、元にする画像を 1 枚と使い方を持てるようにする。
--   edit     元の画像を土台に描き直す（構図・配色を保ち、指示で文字や背景を変える）
--   inspire  雰囲気だけ参考にして新しく作る（色・トーン・質感を引き継ぐ）
-- 参照画像はライブラリの画像（banner_images）。手元のファイルは先にプロジェクトへ
-- 取り込んでから参照する。できた画像は banner_images.parent_image_id で元の画像を指し、
-- edit のときは source='edited' になる（CHECK は 385 で定義済み）。
ALTER TABLE banner_generations ADD COLUMN reference_image_id TEXT REFERENCES banner_images(id);
ALTER TABLE banner_generations ADD COLUMN reference_mode TEXT
  CHECK (reference_mode IS NULL OR reference_mode IN ('edit', 'inspire'));

CREATE INDEX IF NOT EXISTS idx_banner_generations_reference
  ON banner_generations(reference_image_id) WHERE reference_image_id IS NOT NULL;
