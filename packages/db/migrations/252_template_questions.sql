-- シナリオで使う「質問」をテンプレートとして保存する。
--
-- 質問の送信・回答処理は scenario_steps.question_json がすでに正本を持つ。
-- 同じ形をテンプレートにも保持し、シナリオへ追加するときに参照・控えとして
-- 使う。message_type / message_content は、質問を扱えない既存の利用先で誤送信
-- しないよう、質問文のテキスト控えを持つ。
ALTER TABLE templates ADD COLUMN question_json TEXT
  CHECK (question_json IS NULL OR json_valid(question_json));

-- 質問は下書きで保存してから、利用可能なテンプレートとして公開できる。
-- 通常テンプレートはこれまでどおり公開済みとして扱う。
ALTER TABLE templates ADD COLUMN question_status TEXT NOT NULL DEFAULT 'published'
  CHECK (question_status IN ('draft', 'published'));
