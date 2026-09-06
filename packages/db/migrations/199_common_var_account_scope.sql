-- 共通情報をLINEアカウントごとに分離する。
--
-- 既存行の所属は本文中の差し込みだけでは一意に決められないため、推測で
-- 埋めない。NULL の行は管理者による明示割当が終わるまで配信にも一覧にも
-- 出さず、別アカウントの値を誤送信しないことを優先する。
ALTER TABLE common_vars
  ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id) ON DELETE CASCADE;

-- 既存の使用先がすべて同じアカウントを示す場合だけ、その所属を採用する。
-- 2アカウント以上で使われる値や、所属を証明できない値はNULLのまま残す。
-- 各複合SELECTを4項以下に分け、最後のUNIONで使用先の重複を除く。
WITH usage_a(var_id, account_id) AS (
  SELECT DISTINCT cv.id AS var_id, t.line_account_id AS account_id
    FROM common_vars cv JOIN templates t
      ON t.line_account_id IS NOT NULL
     AND instr(coalesce(t.message_content, ''), '{{var.' || cv.var_key || '}}') > 0
  UNION
  SELECT DISTINCT cv.id, b.line_account_id
    FROM common_vars cv JOIN broadcasts b
      ON b.line_account_id IS NOT NULL
     AND instr(coalesce(b.message_content, ''), '{{var.' || cv.var_key || '}}') > 0
  UNION
  SELECT DISTINCT cv.id, s.line_account_id
    FROM common_vars cv JOIN scenario_steps ss
      ON instr(coalesce(ss.message_content, ''), '{{var.' || cv.var_key || '}}') > 0
      OR instr(coalesce(ss.message_bubbles_json, ''), '{{var.' || cv.var_key || '}}') > 0
    JOIN scenarios s ON s.id = ss.scenario_id AND s.line_account_id IS NOT NULL
  UNION
  SELECT DISTINCT cv.id, r.line_account_id
    FROM common_vars cv JOIN reminder_steps rs
      ON instr(coalesce(rs.message_content, ''), '{{var.' || cv.var_key || '}}') > 0
    JOIN reminders r ON r.id = rs.reminder_id AND r.line_account_id IS NOT NULL
), usage_b(var_id, account_id) AS (
  SELECT DISTINCT cv.id, ar.line_account_id
    FROM common_vars cv JOIN auto_replies ar
      ON ar.line_account_id IS NOT NULL
     AND (instr(coalesce(ar.response_content, ''), '{{var.' || cv.var_key || '}}') > 0
       OR instr(coalesce(ar.actions_json, ''), '{{var.' || cv.var_key || '}}') > 0)
  UNION
  SELECT DISTINCT cv.id, a.line_account_id
    FROM common_vars cv JOIN automations a
      ON a.line_account_id IS NOT NULL
     AND (instr(coalesce(a.conditions, ''), '{{var.' || cv.var_key || '}}') > 0
       OR instr(coalesce(a.actions, ''), '{{var.' || cv.var_key || '}}') > 0)
), usage_accounts(var_id, account_id) AS (
  SELECT var_id, account_id FROM usage_a
  UNION
  SELECT var_id, account_id FROM usage_b
)
UPDATE common_vars
   SET line_account_id = (
     SELECT MIN(ua.account_id) FROM usage_accounts ua WHERE ua.var_id = common_vars.id
   )
 WHERE 1 = (
   SELECT COUNT(DISTINCT ua.account_id) FROM usage_accounts ua WHERE ua.var_id = common_vars.id
 );

-- アカウントが1つしかない環境では所属が曖昧にならないため、残りも安全に
-- 引き継げる。複数アカウント環境ではこの補完を行わない。
UPDATE common_vars
   SET line_account_id = (SELECT id FROM line_accounts ORDER BY id LIMIT 1)
 WHERE line_account_id IS NULL
   AND (SELECT COUNT(*) FROM line_accounts) = 1;

CREATE INDEX IF NOT EXISTS idx_common_vars_account_name
  ON common_vars(line_account_id, name, id);
