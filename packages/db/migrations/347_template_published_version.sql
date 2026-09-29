-- 公開中のテンプレート送信文を版として固定する(#645 / 点検#497 N-131)。
--
-- これまでテンプレートの編集は message_type / message_content を直接書き換え、
-- 公開中の配信・自動応答・シナリオが参照する実送信文へ直ちに混入していた。
-- 以後は編集を draft_* 列(下書き)へだけ書き、公開操作で live 列へ写す。
-- 送信側(auto_reply / step_delivery / event_bus / reminder_delivery など)は
-- live 列を読み続けるので、公開版だけを参照する。参照先の id は変わらない。

-- migration 183 より前からあるテンプレートは line_account_id が NULL のまま。
-- 347 の公開版ガードだけを先に入れると、既存の自動送信やリッチメニューが
-- テンプレートを読めず無応答になる。参照元の持ち主が一意に決まる行だけを
-- 補完する。複数アカウントにまたがる、または参照元にも持ち主がない行は、
-- ALTER より前に migration 自体を止める（不完全な公開版へ進めない）。
WITH owner_candidates_a(template_id, line_account_id) AS (
  -- D1 の複合SELECTは 5 項までしか受け付けない(実測値。手元の SQLite は 500)。
  -- 8 項を1つの UNION ALL でつなぐと D1 で
  -- `too many terms in compound SELECT` になり、migration が当たらない(#713)。
  -- そのため 4 項ずつに分けて、最後に 2 項でまとめる。UNION ALL は結合的なので
  -- 結果は 1 本につないだときと同じ。ここを1つに戻さないこと。
  -- 1アカウントだけの環境では、全NULL行の持ち主が一意に決まる。
  SELECT t.id, la.id
    FROM templates t
    JOIN line_accounts la
   WHERE t.line_account_id IS NULL
     AND (SELECT COUNT(*) FROM line_accounts) = 1
  UNION ALL
  SELECT ar.template_id, ar.line_account_id
    FROM auto_replies ar
   WHERE ar.template_id IS NOT NULL AND ar.line_account_id IS NOT NULL
  UNION ALL
  SELECT ss.template_id, s.line_account_id
    FROM scenario_steps ss
    JOIN scenarios s ON s.id = ss.scenario_id
   WHERE ss.template_id IS NOT NULL AND s.line_account_id IS NOT NULL
  UNION ALL
  SELECT rs.template_id, r.line_account_id
    FROM reminder_steps rs
    JOIN reminders r ON r.id = rs.reminder_id
   WHERE rs.template_id IS NOT NULL AND r.line_account_id IS NOT NULL
),
owner_candidates_b(template_id, line_account_id) AS (
  SELECT rma.template_id, rmg.account_id
    FROM rich_menu_areas rma
    JOIN rich_menu_pages rmp ON rmp.id = rma.page_id
    JOIN rich_menu_groups rmg ON rmg.id = rmp.group_id
   WHERE rma.template_id IS NOT NULL
  UNION ALL
  SELECT CAST(j.value AS TEXT), a.line_account_id
    FROM automations a
    JOIN json_tree(a.actions) j
      ON j.key IN ('templateId', 'template_id') AND j.type = 'text'
   WHERE a.line_account_id IS NOT NULL
  UNION ALL
  SELECT CAST(j.value AS TEXT), ca.line_account_id
    FROM common_action_versions cav
    JOIN common_actions ca ON ca.id = cav.common_action_id
    JOIN json_tree(cav.action_config) j
      ON j.key IN ('templateId', 'template_id') AND j.type = 'text'
  UNION ALL
  SELECT CAST(json_extract(fbr.operation_json, '$.templateId') AS TEXT), fbri.line_account_id
    FROM friend_bulk_runs fbr
    JOIN friend_bulk_run_items fbri ON fbri.run_id = fbr.id
   WHERE json_extract(fbr.operation_json, '$.kind') = 'send_message'
     AND json_type(fbr.operation_json, '$.templateId') = 'text'
     AND fbri.line_account_id IS NOT NULL
),
owner_candidates(template_id, line_account_id) AS (
  SELECT template_id, line_account_id FROM owner_candidates_a
  UNION ALL
  SELECT template_id, line_account_id FROM owner_candidates_b
),
referenced_templates_a(template_id) AS (
  -- ここも同じ理由で 4 項と 3 項に分ける(#713)。UNION も結合的なので
  -- 重複の潰れ方を含めて 1 本につないだときと同じ結果になる。
  SELECT template_id FROM auto_replies WHERE template_id IS NOT NULL
  UNION SELECT template_id FROM scenario_steps WHERE template_id IS NOT NULL
  UNION SELECT template_id FROM reminder_steps WHERE template_id IS NOT NULL
  UNION SELECT template_id FROM rich_menu_areas WHERE template_id IS NOT NULL
),
referenced_templates_b(template_id) AS (
  SELECT CAST(j.value AS TEXT) FROM automations a JOIN json_tree(a.actions) j
    ON j.key IN ('templateId', 'template_id') AND j.type = 'text'
  UNION SELECT CAST(j.value AS TEXT) FROM common_action_versions cav JOIN json_tree(cav.action_config) j
    ON j.key IN ('templateId', 'template_id') AND j.type = 'text'
  UNION SELECT CAST(json_extract(operation_json, '$.templateId') AS TEXT)
    FROM friend_bulk_runs
   WHERE json_extract(operation_json, '$.kind') = 'send_message'
     AND json_type(operation_json, '$.templateId') = 'text'
),
referenced_templates(template_id) AS (
  SELECT template_id FROM referenced_templates_a
  UNION
  SELECT template_id FROM referenced_templates_b
)
SELECT CASE WHEN EXISTS (
  SELECT 1
    FROM templates t
    JOIN referenced_templates r ON r.template_id = t.id
   WHERE t.line_account_id IS NULL
     AND (SELECT COUNT(DISTINCT oc.line_account_id)
            FROM owner_candidates oc
           WHERE oc.template_id = t.id) <> 1
) THEN json('MIGRATION_347_TEMPLATE_OWNER_UNRESOLVED') ELSE json('null') END;

WITH owner_candidates_a(template_id, line_account_id) AS (
  -- D1 の複合SELECTは 5 項までしか受け付けない(実測値。手元の SQLite は 500)。
  -- 8 項を1つの UNION ALL でつなぐと D1 で
  -- `too many terms in compound SELECT` になり、migration が当たらない(#713)。
  -- そのため 4 項ずつに分けて、最後に 2 項でまとめる。UNION ALL は結合的なので
  -- 結果は 1 本につないだときと同じ。ここを1つに戻さないこと。
  SELECT t.id, la.id
    FROM templates t
    JOIN line_accounts la
   WHERE t.line_account_id IS NULL
     AND (SELECT COUNT(*) FROM line_accounts) = 1
  UNION ALL
  SELECT ar.template_id, ar.line_account_id
    FROM auto_replies ar
   WHERE ar.template_id IS NOT NULL AND ar.line_account_id IS NOT NULL
  UNION ALL
  SELECT ss.template_id, s.line_account_id
    FROM scenario_steps ss
    JOIN scenarios s ON s.id = ss.scenario_id
   WHERE ss.template_id IS NOT NULL AND s.line_account_id IS NOT NULL
  UNION ALL
  SELECT rs.template_id, r.line_account_id
    FROM reminder_steps rs
    JOIN reminders r ON r.id = rs.reminder_id
   WHERE rs.template_id IS NOT NULL AND r.line_account_id IS NOT NULL
),
owner_candidates_b(template_id, line_account_id) AS (
  SELECT rma.template_id, rmg.account_id
    FROM rich_menu_areas rma
    JOIN rich_menu_pages rmp ON rmp.id = rma.page_id
    JOIN rich_menu_groups rmg ON rmg.id = rmp.group_id
   WHERE rma.template_id IS NOT NULL
  UNION ALL
  SELECT CAST(j.value AS TEXT), a.line_account_id
    FROM automations a
    JOIN json_tree(a.actions) j
      ON j.key IN ('templateId', 'template_id') AND j.type = 'text'
   WHERE a.line_account_id IS NOT NULL
  UNION ALL
  SELECT CAST(j.value AS TEXT), ca.line_account_id
    FROM common_action_versions cav
    JOIN common_actions ca ON ca.id = cav.common_action_id
    JOIN json_tree(cav.action_config) j
      ON j.key IN ('templateId', 'template_id') AND j.type = 'text'
  UNION ALL
  SELECT CAST(json_extract(fbr.operation_json, '$.templateId') AS TEXT), fbri.line_account_id
    FROM friend_bulk_runs fbr
    JOIN friend_bulk_run_items fbri ON fbri.run_id = fbr.id
   WHERE json_extract(fbr.operation_json, '$.kind') = 'send_message'
     AND json_type(fbr.operation_json, '$.templateId') = 'text'
     AND fbri.line_account_id IS NOT NULL
),
owner_candidates(template_id, line_account_id) AS (
  SELECT template_id, line_account_id FROM owner_candidates_a
  UNION ALL
  SELECT template_id, line_account_id FROM owner_candidates_b
),
resolved_owners AS (
  SELECT template_id, MIN(line_account_id) AS line_account_id
    FROM owner_candidates
   GROUP BY template_id
  HAVING COUNT(DISTINCT line_account_id) = 1
)
UPDATE templates
   SET line_account_id = (
     SELECT ro.line_account_id FROM resolved_owners ro WHERE ro.template_id = templates.id
   )
 WHERE line_account_id IS NULL
   AND id IN (SELECT template_id FROM resolved_owners);

ALTER TABLE templates ADD COLUMN published_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE templates ADD COLUMN published_at TEXT;
ALTER TABLE templates ADD COLUMN draft_message_type TEXT;
ALTER TABLE templates ADD COLUMN draft_message_content TEXT;
ALTER TABLE templates ADD COLUMN draft_carousel_actions_json TEXT;
ALTER TABLE templates ADD COLUMN draft_carousel_tap_limit_mode TEXT;
ALTER TABLE templates ADD COLUMN draft_carousel_tap_limit_text TEXT;
ALTER TABLE templates ADD COLUMN draft_question_json TEXT
  CHECK (draft_question_json IS NULL OR json_valid(draft_question_json));
ALTER TABLE templates ADD COLUMN draft_question_status TEXT
  CHECK (draft_question_status IS NULL OR draft_question_status IN ('draft', 'published'));
ALTER TABLE templates ADD COLUMN publish_idempotency_key TEXT;
-- 差し戻し対応(#645 6要件): 下書きの版。保存のたびに +1 し、公開で 0 に戻す。
-- 公開口はこの番号も確認し、検査後に別人が書き換えた下書きを出さない。
ALTER TABLE templates ADD COLUMN draft_revision INTEGER NOT NULL DEFAULT 0;

-- 既存テンプレートは公開済みとして扱い、参照先なしを作らない。
-- 新規作成は未公開の下書きで始めるので、作った直後は送信候補に出さない。
UPDATE templates SET published_at = updated_at WHERE published_at IS NULL;
-- 移行時点で下書きが残っていた行は、全文スナップショットがあるものとして版1にする。
UPDATE templates SET draft_revision = 1 WHERE draft_revision = 0 AND (
  draft_message_type IS NOT NULL OR draft_message_content IS NOT NULL
  OR draft_carousel_actions_json IS NOT NULL OR draft_carousel_tap_limit_mode IS NOT NULL
  OR draft_carousel_tap_limit_text IS NOT NULL OR draft_question_json IS NOT NULL
  OR draft_question_status IS NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_templates_publish_key ON templates (publish_idempotency_key);

-- 差し戻し対応(#645 要件5): 公開の確認キーの履歴。成功した公開は
-- 下書きなしの成功も含めて残し、後日の同キー再試行で別下書きを出さない。
-- 古い複数の成功キーもここに残る(最新1件だけの列では足りないため)。
CREATE TABLE IF NOT EXISTS template_publish_keys (
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  published_version INTEGER NOT NULL,
  draft_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  -- 再審査対応: 同キー再試行の内容比較用指紋と、固定応答の控え。
  -- 指紋が違えば別操作の使い回しとして409。応答は記録時の版・本文を返す。
  draft_fingerprint TEXT NOT NULL DEFAULT '',
  message_type TEXT,
  message_content TEXT,
  PRIMARY KEY (template_id, idempotency_key)
);
