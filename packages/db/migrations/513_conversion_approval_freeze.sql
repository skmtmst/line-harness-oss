-- m22u 監査 R356・R357・R354：承認した時点の金額・マイル・通知世代を成果に保存する。
--
-- これまで承認時の金額は affiliate_reward_calculations の版だけが持ち、
-- マイルは案件の現在値をその都度読んでいた。版の保存に失敗した後の再試行や
-- 設定変更後に、過去の承認が新しい設定で上書きされる問題があった
-- (R356: 再送で0→300マイル、R357: 再試行で1000円→5000円)。
-- 承認の UPDATE が通った時点でこの列へ凍結し、再試行・締め・通知は
-- 凍結値を優先する。通知の送信記録(R354)も同じ行に載せ、同じ承認世代の
-- 二重送信を止めつつ、欠けた通知だけ再試行で送る。
--
-- 付け足すだけ(ADD COLUMN)。既存の行はすべて NULL のままで、
-- NULL の行は従来どおり現在の設定を読む(今の動きを変えない)。
ALTER TABLE conversion_events ADD COLUMN approval_amount_minor INTEGER;
ALTER TABLE conversion_events ADD COLUMN approval_formula TEXT;
ALTER TABLE conversion_events ADD COLUMN approval_commission_rate REAL;
ALTER TABLE conversion_events ADD COLUMN approval_base_amount REAL;
ALTER TABLE conversion_events ADD COLUMN approval_fixed_reward INTEGER;
ALTER TABLE conversion_events ADD COLUMN approval_reward_miles INTEGER;
ALTER TABLE conversion_events ADD COLUMN approval_notified_generation TEXT;
