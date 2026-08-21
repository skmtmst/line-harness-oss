-- リマインダの配信タイミングを、運用者の言葉で指定できるようにする。
--
-- いまは「オフセット（分）」しか入れられない。運用者は「3日前の10時」と
-- 考えるので、分に直させるのは無理がある。しかもゴールの時刻で答えが変わる。
-- ゴールが 15:00 の予約なら -4620分、10:00 の予約なら -4320分。同じ
-- 「3日前の10時」なのに、予約ごとに違う数字を入れることになる。
--
--   offset_days    ゴールから何日前（負）／何日後（正）
--   send_at_time   その日の何時（日本時間の "HH:MM"）
--   template_id    送る中身をテンプレートから選ぶ
--
-- offset_minutes はそのまま残す。offset_days と send_at_time の両方が
-- 入っていればそちらを見て、無ければ今までどおり offset_minutes を見る。
-- いま登録されているリマインダの動きは変わらない。
--
-- template_id に外部キーを張らないのは、テンプレートを消したときに
-- リマインダごと消えるのを避けるため。参照が切れたら message_content を
-- そのまま送る（自動応答の template_id と同じ考え方）。
ALTER TABLE reminder_steps ADD COLUMN offset_days INTEGER;
ALTER TABLE reminder_steps ADD COLUMN send_at_time TEXT;
ALTER TABLE reminder_steps ADD COLUMN template_id TEXT;

-- 配信方式は、リマインダごとに1つだけ持つ。
--
-- Lステップは作成時にどちらかを選ばせ、**作成後は変えられない**ようにしている。
-- 途中で変えると、すでに登録済みの友だちの配信予定がすべて変わるため。
-- 「3日前」で予約が入っている人が、突然「4320分前」の解釈に切り替わる。
--
--   'time'      … ゴールの○日前の●時（offset_days + send_at_time）
--   'countdown' … ゴールから何分ずらすか（offset_minutes）
--
-- 既にあるリマインダは 'countdown'。いまの動きのまま変わらない。
ALTER TABLE reminders ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'countdown';
