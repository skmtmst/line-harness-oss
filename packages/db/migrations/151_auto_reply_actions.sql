-- 自動応答を、Lステップの実運用に耐える形にするための列。
--
-- 実データで見た自動応答は、どれも「タグを付けて、そのあとテキストを送る」
-- という組だった。いまは応答が1つしか持てない（response_type と
-- response_content）ので、実運用のルールが1つも作れない。
--
-- 増やす列。
--
--   actions_json         応答したときに順に実行することの並び。
--                        形はシナリオのアクション（scenario-actions.ts）と
--                        同じにする。自動応答専用のアクションは作らない。
--
--   response_weekdays_json  応答する曜日（0=日 … 6=土 の配列）。
--                        空か未設定なら「すべての曜日」。
--                        時間帯そのものは active_from / active_until が
--                        既にあるので足さない。
--
--   response_holiday_rule   祝日の扱い。
--                        'ignore'  … 祝日を見ない（既定）
--                        'include' … 選んだ曜日に加えて祝日も応答する
--                        'exclude' … 選んだ曜日でも祝日なら応答しない
--
--   once_per_friend      1人につき1回だけ応答するか。
--                        cooldown_minutes（連投の抑制）とは別。
--                        あちらは「N分空ける」、こちらは「二度と応答しない」。
--
--   keywords_json        キーワードを複数行持つための並び。
--                        1行ごとに、言葉・マッチ方法・最低字数・
--                        文字の種類を区別するかを持つ。
--                        未設定なら、これまでどおり keyword と match_type を見る。
--
-- どの列も未設定で今までどおり動く。既にあるルールの挙動は変わらない。
ALTER TABLE auto_replies ADD COLUMN actions_json TEXT;
ALTER TABLE auto_replies ADD COLUMN response_weekdays_json TEXT;
ALTER TABLE auto_replies ADD COLUMN response_holiday_rule TEXT;
ALTER TABLE auto_replies ADD COLUMN once_per_friend INTEGER NOT NULL DEFAULT 0;
ALTER TABLE auto_replies ADD COLUMN keywords_json TEXT;
