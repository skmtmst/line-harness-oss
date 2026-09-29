-- m23b 監査 R475：共通アクションの新規作成に再試行の目印を持たせる。
--
-- 保存確定後の応答消失から同じ内容で再試行すると、作成要求に同一操作を
-- 識別する鍵がなく、同じ内容が別IDで二重作成されていた。
-- 作成画面が初回保存から再試行まで同じ鍵を送り、鍵が同じ要求は最初の
-- 作成を返して二重作成にしない。意図した別の新規作成は別の鍵で独立する。
--
-- 付け足すだけ(ADD COLUMN + UNIQUE INDEX)。既存の行の鍵はすべて NULL で、
-- NULL 同士は重複とみなさないため従来の作成は今の動きのまま。
ALTER TABLE common_actions ADD COLUMN client_request_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_common_actions_request_key
  ON common_actions(line_account_id, client_request_key);
