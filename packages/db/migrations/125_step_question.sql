-- 質問メッセージ。選択肢と、選択肢ごとの挙動をまとめて入れる。
-- 形は services/scenario-question.ts に書いてある。
-- NULL なら、この通は質問ではない。
ALTER TABLE scenario_steps ADD COLUMN question_json TEXT;
