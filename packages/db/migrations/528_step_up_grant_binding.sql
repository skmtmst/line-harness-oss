-- m23d 確認票の結び付け: 本人確認の印（grant）を発行したセッションと
-- 発行時の権限の版に結び付ける。
--
-- 使っていない確認票がログアウトや権限の更新の後でも新しいログインで
-- 使えていた不具合を直す。ログアウト・セッション終了・権限の更新の
-- どれかが起きたら、その確認票は使えない（使う側で再認証を案内する）。
-- 付け足すだけ（既存の列・行は今の動き。移行前の確認票は結び付け無しで
-- 従来どおり使えるが、有効期限5分で自然に消える）。

ALTER TABLE auth_step_up_grants ADD COLUMN session_token_hash TEXT;

ALTER TABLE auth_step_up_grants ADD COLUMN issued_policy_version INTEGER;
