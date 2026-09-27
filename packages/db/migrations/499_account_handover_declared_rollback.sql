-- X-3: Lステップ引っ越しの件数照合と7日間の切り戻し（v6-33 §12-2/§12-6）。
-- 追加のみ。引き継ぎの本体（account_handovers / account_handover_decisions）は既存。

-- 移し元システム側の申告件数（運用者が画面で入力）。dry-run の合計と
-- 違うままでは本実行しない。
ALTER TABLE account_handovers ADD COLUMN declared_friend_total INTEGER;

-- 切り戻し。completed から7日間だけ許可し、戻した記録を残す。
ALTER TABLE account_handovers ADD COLUMN rolled_back_at TEXT;
ALTER TABLE account_handovers ADD COLUMN rolled_back_by TEXT;
ALTER TABLE account_handovers ADD COLUMN rollback_note TEXT;
