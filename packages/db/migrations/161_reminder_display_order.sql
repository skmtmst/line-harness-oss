-- リマインダを並べ替えられるようにする。
--
-- 一覧は `created_at DESC` の固定で、画面の「並び替え」ボタンは押せない状態で
-- 置いてあった。タグ・シナリオ・リッチメニューは display_order で並べ替えられる
-- のに、リマインダだけ作った順の逆から動かせなかった。
--
-- 誕生日・契約更新・次回お届け日のように、運用上の優先度が作った順と
-- 一致しないものが並ぶ画面なので、並べ替えの需要がそのまま出る。
--
-- 既定は 0。既存の行は全部 0 になるので、同じ値のときは created_at DESC で
-- 割る（これまでの並びが変わらない）。並べ替えを1回でもすると、
-- そのとき見えていた順に 0,1,2… が入る。
ALTER TABLE reminders ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_reminders_display_order ON reminders(display_order, created_at);
