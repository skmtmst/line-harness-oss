-- WEB208: 報酬なし・案件ごとの定額・売上の率を保存する（オーナー承認 2026-10-08）。
-- NULL は旧い登録経路だけの互換値。API の新規登録では必ず方式を保存する。
ALTER TABLE affiliates ADD COLUMN reward_mode TEXT CHECK (reward_mode IN ('none', 'fixed', 'rate'));
UPDATE affiliates SET reward_mode = CASE WHEN commission_rate > 0 THEN 'rate' ELSE 'fixed' END
WHERE reward_mode IS NULL;
-- 過去の承認額・計算版・支払い台帳は変更しない。
