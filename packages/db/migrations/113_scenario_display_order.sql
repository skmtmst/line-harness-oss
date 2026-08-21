-- シナリオの並び順と、通の配信後の処理。
--
-- ■ scenarios.display_order
-- 設計（V2 4-1）は一覧の各行の左に掴む印があり、上下に入れ替えられる。
-- よく使うシナリオを上に置くための操作で、並びを覚える列が無く「購読中が
-- 多い順」など決まった並びしか出せなかった。tags（112）と同じ形にそろえる。
--
-- ■ scenario_steps.after_send
-- 設計（V2 4-1-1）のコンテンツ表に「配信後」列があり、この通を送ったあと
-- シナリオを止めるかどうかを持つ。体調の記録をお願いして返事を待つ、と
-- いった流れで要る。列が無く、送ったら必ず次へ進んでいた。
--
-- 'continue' が既定。既にある通の動きは変わらない。
ALTER TABLE scenarios ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scenario_steps ADD COLUMN after_send TEXT NOT NULL DEFAULT 'continue'
  CHECK (after_send IN ('continue', 'pause'));

CREATE INDEX IF NOT EXISTS idx_scenarios_order ON scenarios (display_order);
