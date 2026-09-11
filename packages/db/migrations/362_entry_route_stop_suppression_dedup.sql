-- N-244: 抑止台帳の重複防止。同一利用者・同一refの記録が真の並行で
-- 重なっても1行に寄せる(期限切れ後の再試行は有効期限を延ばす)。
-- 先に決定的に重複を整理してから一意索引を作る (同順位は発生日・id順で1行残す)。
DELETE FROM entry_route_stop_suppressions
WHERE id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY line_account_id, line_user_id, ref_code
      ORDER BY occurred_at ASC, id ASC
    ) AS rn
    FROM entry_route_stop_suppressions
  )
  WHERE rn = 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stop_suppressions_dedup
  ON entry_route_stop_suppressions (line_account_id, line_user_id, ref_code);
