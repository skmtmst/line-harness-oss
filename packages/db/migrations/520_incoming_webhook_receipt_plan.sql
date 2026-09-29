-- R402: 受信時の実行計画を受領行へ固定する。
--
-- 受領の再試行がその時点の設定を読み直すと、運用中の設定変更が
-- すでに受け取った出来事の処理内容を不揃いに変えていた
-- （未実行の取りこぼし・新しい処理の混入・保留対象の消失）。
-- 受領時に照合方法・未一致時の扱い・処理配列全体・参照版を
-- 一つの実行計画として保存し、再試行はその計画を最後まで使う。
-- 後日の設定変更は新規受信へだけ適用する。
-- 付け足すだけ（既存の列・行は今の動き）。

ALTER TABLE incoming_webhook_receipts ADD COLUMN config_version INTEGER;
ALTER TABLE incoming_webhook_receipts ADD COLUMN identity_match_json TEXT;
ALTER TABLE incoming_webhook_receipts ADD COLUMN action_refs_json TEXT;
