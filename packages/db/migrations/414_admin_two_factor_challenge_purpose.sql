-- N-426/N-434: 二段階認証challengeに用途（verify/setup）と記憶ログイン選択を持たせる。
-- 未設定の管理者は通常セッションを取れず、設定専用のchallenge経由でTOTPを登録する。
ALTER TABLE admin_two_factor_challenges ADD COLUMN purpose TEXT NOT NULL DEFAULT 'verify';
ALTER TABLE admin_two_factor_challenges ADD COLUMN remember INTEGER NOT NULL DEFAULT 0;
