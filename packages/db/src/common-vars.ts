import { jstNow } from './utils.js';

/**
 * 共通情報。
 *
 * 営業時間や電話番号のように、いくつものテンプレートに同じ文字が
 * 散らばるものを1か所にまとめる。変えるときに全テンプレートを
 * 探して回らなくてよくなる。
 */

export const COMMON_VAR_TYPES = ['text', 'url', 'image', 'number'] as const;
export type CommonVarType = (typeof COMMON_VAR_TYPES)[number];

export interface CommonVar {
  id: string;
  line_account_id: string | null;
  folder_id: string | null;
  name: string;
  var_key: string;
  type: string;
  value: string;
  created_at: string;
  updated_at: string;
  /** 一覧用。未反映の次回予約を一覧APIでまとめて返し、行ごとのAPI呼出を避ける。 */
  next_effective_from?: string | null;
  next_value?: string | null;
  pending_schedule_count?: number;
  /** 一覧用。現在・過去を含め、差し込まれている場所の合計。 */
  usage_count?: number;
}

export type CommonVarUsageKind =
  | 'template'
  | 'broadcast'
  | 'scenario'
  | 'reminder'
  | 'auto_reply'
  | 'form'
  | 'automation'
  | 'friend_add'
  | 'common_action';

export interface CommonVarUsageImpact {
  total: number;
  /** 過去に送り終わった配信を除き、削除すると現在の設定が壊れる件数。 */
  blockingTotal: number;
  /** 送信済みで、共通情報を削除しても過去の配信内容が変わらない件数。 */
  historicalTotal: number;
  /** LINEアカウントへの所属が無く、名前や本文を安全に返せない古いフォーム。 */
  unscopedFormTotal: number;
  byKind: Record<CommonVarUsageKind, number>;
  items: CommonVarUsageItem[];
}

export interface CommonVarUsageItem {
  kind: CommonVarUsageKind;
  source_id: string;
  source_parent_id: string | null;
  source_name: string;
  source_status: string | null;
  source_content: string;
  is_historical: number;
}

const COMMON_VAR_USAGE_QUERIES: Array<{
  kind: CommonVarUsageKind;
  sql: string;
  values: (varKey: string, token: string, lineAccountId: string) => string[];
}> = [
  {
    kind: 'template',
    sql: `SELECT t.id AS source_id, NULL AS source_parent_id, t.name AS source_name,
                 'active' AS source_status,
                 CASE WHEN instr(coalesce(t.message_content, ''), ?) > 0
                      THEN t.message_content
                      WHEN instr(coalesce(t.question_json, ''), ?) > 0
                      THEN t.question_json ELSE coalesce(t.carousel_actions_json, '') END AS source_content,
                 0 AS is_historical
            FROM templates t
           WHERE t.line_account_id = ?
             AND (instr(coalesce(t.message_content, ''), ?) > 0
               OR instr(coalesce(t.question_json, ''), ?) > 0
               OR instr(coalesce(t.carousel_actions_json, ''), ?) > 0
               OR EXISTS (
                 SELECT 1 FROM json_tree(CASE WHEN json_valid(t.carousel_actions_json)
                                              THEN t.carousel_actions_json ELSE 'null' END) j
                  WHERE j.key = 'varKey' AND CAST(j.value AS TEXT) = ?
               ))`,
    values: (varKey, token, account) => [token, token, account, token, token, token, varKey],
  },
  {
    kind: 'broadcast',
    sql: `SELECT b.id AS source_id, NULL AS source_parent_id, b.title AS source_name,
                 b.status AS source_status,
                 CASE WHEN instr(coalesce(b.message_content, ''), ?) > 0
                      THEN b.message_content ELSE coalesce(b.message_bubbles_json, '') END AS source_content,
                 CASE WHEN b.status = 'sent' THEN 1 ELSE 0 END AS is_historical
            FROM broadcasts b
           WHERE (b.line_account_id = ? OR EXISTS (
                   SELECT 1 FROM json_each(coalesce(b.account_ids, '[]')) WHERE value = ?
                 ))
             AND (instr(coalesce(b.message_content, ''), ?) > 0
               OR instr(coalesce(b.message_bubbles_json, ''), ?) > 0)`,
    values: (_varKey, token, account) => [token, account, account, token, token],
  },
  {
    kind: 'scenario',
    sql: `SELECT ss.id AS source_id, s.id AS source_parent_id,
                 s.name || '・' || CAST(ss.step_order AS TEXT) || '通目' AS source_name,
                 CASE WHEN s.is_active = 1 THEN 'active' ELSE 'stopped' END AS source_status,
                 CASE WHEN instr(coalesce(ss.message_content, ''), ?) > 0
                      THEN ss.message_content
                      WHEN instr(coalesce(ss.message_bubbles_json, ''), ?) > 0
                      THEN ss.message_bubbles_json ELSE coalesce(ss.question_json, '') END AS source_content,
                 0 AS is_historical
            FROM scenario_steps ss JOIN scenarios s ON s.id = ss.scenario_id
           WHERE s.line_account_id = ?
             AND (instr(coalesce(ss.message_content, ''), ?) > 0
               OR instr(coalesce(ss.message_bubbles_json, ''), ?) > 0
               OR instr(coalesce(ss.question_json, ''), ?) > 0)
           UNION ALL
          SELECT sa.id AS source_id, s.id AS source_parent_id,
                 s.name || '・共通情報操作' AS source_name,
                 CASE WHEN s.is_active = 1 THEN 'active' ELSE 'stopped' END AS source_status,
                 sa.config_json AS source_content, 0 AS is_historical
           FROM scenario_actions sa JOIN scenarios s ON s.id = sa.scenario_id
           WHERE s.line_account_id = ? AND sa.action_type = 'common_var'
             AND json_extract(CASE WHEN json_valid(sa.config_json)
                                   THEN sa.config_json ELSE 'null' END, '$.varKey') = ?`,
    values: (varKey, token, account) => [
      token, token, account, token, token, token, account, varKey,
    ],
  },
  {
    kind: 'reminder',
    sql: `SELECT rs.id AS source_id, r.id AS source_parent_id, r.name AS source_name,
                 CASE WHEN r.is_active = 1 THEN 'active' ELSE 'stopped' END AS source_status,
                 rs.message_content AS source_content, 0 AS is_historical
            FROM reminder_steps rs JOIN reminders r ON r.id = rs.reminder_id
           WHERE r.line_account_id = ? AND instr(coalesce(rs.message_content, ''), ?) > 0`,
    values: (_varKey, token, account) => [account, token],
  },
  {
    kind: 'auto_reply',
    sql: `SELECT ar.id AS source_id, NULL AS source_parent_id,
                 coalesce(nullif(ar.name, ''), ar.keyword) AS source_name,
                 CASE WHEN ar.is_active = 1 THEN 'active' ELSE 'stopped' END AS source_status,
                 CASE WHEN instr(coalesce(ar.response_content, ''), ?) > 0
                      THEN ar.response_content ELSE coalesce(ar.actions_json, '') END AS source_content,
                 0 AS is_historical
            FROM auto_replies ar
           WHERE ar.line_account_id = ?
             AND (instr(coalesce(ar.response_content, ''), ?) > 0
               OR instr(coalesce(ar.actions_json, ''), ?) > 0
               OR EXISTS (
                 SELECT 1 FROM json_tree(CASE WHEN json_valid(ar.actions_json)
                                              THEN ar.actions_json ELSE 'null' END) j
                  WHERE j.key = 'varKey' AND CAST(j.value AS TEXT) = ?
               ))`,
    values: (varKey, token, account) => [token, account, token, token, varKey],
  },
  {
    kind: 'form',
    sql: `SELECT f.id AS source_id, NULL AS source_parent_id, f.name AS source_name,
                 CASE WHEN f.is_active = 1 THEN 'active' ELSE 'stopped' END AS source_status,
                 CASE WHEN instr(coalesce(f.on_submit_message_content, ''), ?) > 0
                      THEN f.on_submit_message_content
                      WHEN instr(coalesce(f.fields, ''), ?) > 0 THEN f.fields
                      ELSE coalesce(f.layout, '') END AS source_content,
                 0 AS is_historical
            FROM forms f JOIN form_accounts fa ON fa.form_id = f.id
           WHERE fa.line_account_id = ?
             AND (instr(coalesce(f.on_submit_message_content, ''), ?) > 0
               OR instr(coalesce(f.fields, ''), ?) > 0
               OR instr(coalesce(f.layout, ''), ?) > 0)`,
    values: (_varKey, token, account) => [token, token, account, token, token, token],
  },
  {
    kind: 'automation',
    sql: `SELECT a.id AS source_id, NULL AS source_parent_id, a.name AS source_name,
                 CASE WHEN a.is_active = 1 THEN 'active' ELSE 'stopped' END AS source_status,
                 CASE WHEN instr(coalesce(a.conditions, ''), ?) > 0
                      THEN a.conditions ELSE coalesce(a.actions, '') END AS source_content,
                 0 AS is_historical
            FROM automations a
           WHERE a.line_account_id = ?
             AND (instr(coalesce(a.conditions, ''), ?) > 0
               OR instr(coalesce(a.actions, ''), ?) > 0
               OR EXISTS (
                 SELECT 1 FROM json_tree(CASE WHEN json_valid(a.actions)
                                              THEN a.actions ELSE 'null' END) j
                  WHERE j.key = 'varKey' AND CAST(j.value AS TEXT) = ?
               ))
           UNION ALL
          SELECT d.id AS source_id, NULL AS source_parent_id, d.name AS source_name,
                 d.status AS source_status, '共通情報を使う操作があります' AS source_content,
                 0 AS is_historical
            FROM automation_definitions d
           WHERE d.line_account_id = ? AND EXISTS (
             SELECT 1 FROM automation_versions v
              WHERE v.automation_id = d.id
                AND v.id IN (d.current_draft_version_id, d.current_published_version_id)
                AND (instr(coalesce(v.trigger_config, ''), ?) > 0
                  OR instr(coalesce(v.condition_config, ''), ?) > 0
                  OR instr(coalesce(v.action_config, ''), ?) > 0
                  OR EXISTS (
                    SELECT 1 FROM json_tree(CASE WHEN json_valid(v.action_config)
                                                 THEN v.action_config ELSE 'null' END) j
                     WHERE j.key = 'varKey' AND CAST(j.value AS TEXT) = ?
                  ))
           )`,
    values: (varKey, token, account) => [
      token, account, token, token, varKey,
      account, token, token, token, varKey,
    ],
  },
  {
    kind: 'friend_add',
    sql: `SELECT s.id AS source_id, NULL AS source_parent_id,
                 '友だち追加時の設定' AS source_name, 'active' AS source_status,
                 s.value AS source_content, 0 AS is_historical
            FROM account_settings s
           WHERE s.line_account_id = ? AND s.key = 'friend_add_routing'
             AND (instr(coalesce(s.value, ''), ?) > 0 OR EXISTS (
               SELECT 1 FROM json_tree(CASE WHEN json_valid(s.value)
                                            THEN s.value ELSE 'null' END) j
                WHERE j.key = 'varKey' AND CAST(j.value AS TEXT) = ?
             ))`,
    values: (varKey, token, account) => [account, token, varKey],
  },
  {
    kind: 'common_action',
    sql: `SELECT a.id AS source_id, NULL AS source_parent_id, a.name AS source_name,
                 a.status AS source_status, '共通情報を使う操作があります' AS source_content,
                 0 AS is_historical
            FROM common_actions a
           WHERE a.line_account_id = ? AND EXISTS (
             SELECT 1 FROM common_action_versions v
              WHERE v.common_action_id = a.id
                AND v.id IN (a.current_draft_version_id, a.current_published_version_id)
                AND (instr(coalesce(v.action_config, ''), ?) > 0 OR EXISTS (
                  SELECT 1 FROM json_tree(CASE WHEN json_valid(v.action_config)
                                               THEN v.action_config ELSE 'null' END) j
                   WHERE j.key = 'varKey' AND CAST(j.value AS TEXT) = ?
                ))
           )`,
    values: (varKey, token, account) => [account, token, varKey],
  },
];

const COMMON_VAR_USAGE_TOTAL_SQL = `SELECT
  ${COMMON_VAR_USAGE_QUERIES.map((source) =>
    `(SELECT COUNT(*) FROM (${source.sql}))`).join('\n  + ')}
  + (SELECT COUNT(*) FROM forms f
      WHERE NOT EXISTS (SELECT 1 FROM form_accounts fa WHERE fa.form_id = f.id)
        AND (instr(coalesce(f.on_submit_message_content, ''), ?) > 0
          OR instr(coalesce(f.fields, ''), ?) > 0
          OR instr(coalesce(f.layout, ''), ?) > 0)) AS total`;

/**
 * 一覧に出す使用先件数をまとめて数える。
 *
 * ブラウザから1行ずつ影響APIを呼ぶと、一覧表示だけで多数のHTTP往復が起きる。
 * ここでは各キーの9種類の走査を1文へまとめ、D1のbatchも80件ずつに区切る。
 */
export async function getCommonVarUsageCounts(
  db: D1Database,
  varKeys: string[],
  lineAccountId: string,
): Promise<Map<string, number>> {
  const uniqueKeys = [...new Set(varKeys)];
  const counts = new Map<string, number>();
  const batchSize = 80;

  for (let offset = 0; offset < uniqueKeys.length; offset += batchSize) {
    const keys = uniqueKeys.slice(offset, offset + batchSize);
    const statements = keys.map((varKey) => {
      const token = `{{var.${varKey}}}`;
      const values = COMMON_VAR_USAGE_QUERIES.flatMap((source) =>
        source.values(varKey, token, lineAccountId));
      return db.prepare(COMMON_VAR_USAGE_TOTAL_SQL)
        .bind(...values, token, token, token);
    });
    const results = await db.batch<{ total: number }>(statements);
    keys.forEach((varKey, index) => {
      counts.set(varKey, Number(results[index]?.results[0]?.total ?? 0));
    });
  }

  return counts;
}

export interface CommonVarSchedule {
  id: string;
  var_id: string;
  effective_from: string;
  value: string;
  applied_at: string | null;
}

export async function getCommonVars(
  db: D1Database,
  opts: { folderId?: string; lineAccountId: string },
): Promise<CommonVar[]> {
  const overview = `,
    (SELECT s.effective_from FROM common_var_schedules s
      WHERE s.var_id = common_vars.id AND s.applied_at IS NULL
      ORDER BY s.effective_from ASC, s.id ASC LIMIT 1) AS next_effective_from,
    (SELECT s.value FROM common_var_schedules s
      WHERE s.var_id = common_vars.id AND s.applied_at IS NULL
      ORDER BY s.effective_from ASC, s.id ASC LIMIT 1) AS next_value,
    (SELECT COUNT(*) FROM common_var_schedules s
      WHERE s.var_id = common_vars.id AND s.applied_at IS NULL) AS pending_schedule_count`;
  if (opts.folderId) {
    const result = await db
      .prepare(`SELECT common_vars.* ${overview} FROM common_vars WHERE line_account_id = ? AND folder_id = ? ORDER BY name ASC`)
      .bind(opts.lineAccountId, opts.folderId)
      .all<CommonVar>();
    return result.results;
  }
  const result = await db
    .prepare(`SELECT common_vars.* ${overview} FROM common_vars WHERE line_account_id = ? ORDER BY name ASC`)
    .bind(opts.lineAccountId)
    .all<CommonVar>();
  return result.results;
}

/**
 * 従来キーの差し込みを厳密なトークン単位で数える。
 * LIKEはアンダースコアをワイルドカード扱いするため使わない。
 * 1種類でも走査できなければ例外にし、削除を安全側に止める。
 */
export async function getCommonVarUsageImpact(
  db: D1Database,
  varKey: string,
  lineAccountId: string,
): Promise<CommonVarUsageImpact> {
  const token = `{{var.${varKey}}}`;
  const byKind = Object.fromEntries(
    COMMON_VAR_USAGE_QUERIES.map((source) => [source.kind, 0]),
  ) as Record<CommonVarUsageKind, number>;
  const items: CommonVarUsageItem[] = [];

  for (const source of COMMON_VAR_USAGE_QUERIES) {
    const result = await db.prepare(source.sql)
      .bind(...source.values(varKey, token, lineAccountId))
      .all<Omit<CommonVarUsageItem, 'kind'>>();
    const found = result.results.map((item) => ({ ...item, kind: source.kind }));
    items.push(...found);
    byKind[source.kind] = found.length;
  }

  // form_accounts が1件も無い古いフォームだけは、どのアカウントのものか
  // 確定できない。名前や本文は返さず、件数だけ残して削除を安全側に止める。
  const unscopedForms = await db.prepare(
    `SELECT COUNT(*) AS count FROM forms f
      WHERE NOT EXISTS (SELECT 1 FROM form_accounts fa WHERE fa.form_id = f.id)
        AND (instr(coalesce(f.on_submit_message_content, ''), ?) > 0
          OR instr(coalesce(f.fields, ''), ?) > 0
          OR instr(coalesce(f.layout, ''), ?) > 0)`,
  ).bind(token, token, token).first<{ count: number }>();
  const unscopedFormTotal = Number(unscopedForms?.count ?? 0);
  byKind.form += unscopedFormTotal;

  const historicalTotal = items.reduce(
    (sum, item) => sum + (item.is_historical === 1 ? 1 : 0),
    0,
  );
  const total = items.length + unscopedFormTotal;
  return {
    total,
    blockingTotal: total - historicalTotal,
    historicalTotal,
    unscopedFormTotal,
    byKind,
    items,
  };
}

export async function getCommonVarById(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<CommonVar | null> {
  return db.prepare(`SELECT * FROM common_vars WHERE id = ? AND line_account_id = ?`)
    .bind(id, lineAccountId).first<CommonVar>();
}

export async function createCommonVar(
  db: D1Database,
  input: {
    name: string;
    lineAccountId: string;
    varKey: string;
    value?: string;
    type?: CommonVarType;
    folderId?: string | null;
  },
): Promise<CommonVar> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO common_vars (id, line_account_id, folder_id, name, var_key, type, value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.lineAccountId,
      input.folderId ?? null,
      input.name,
      input.varKey,
      input.type ?? 'text',
      input.value ?? '',
      now,
      now,
    )
    .run();
  return (await getCommonVarById(db, id, input.lineAccountId))!;
}

export async function updateCommonVar(
  db: D1Database,
  id: string,
  lineAccountId: string,
  input: { name?: string; value?: string; folderId?: string | null },
): Promise<CommonVar | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) {
    sets.push('name = ?');
    values.push(input.name);
  }
  if (input.value !== undefined) {
    sets.push('value = ?');
    values.push(input.value);
  }
  if ('folderId' in input) {
    sets.push('folder_id = ?');
    values.push(input.folderId ?? null);
  }
  if (sets.length > 0) {
    sets.push('updated_at = ?');
    values.push(jstNow(), id);
    values.push(lineAccountId);
    await db.prepare(`UPDATE common_vars SET ${sets.join(', ')} WHERE id = ? AND line_account_id = ?`).bind(...values).run();
  }
  return getCommonVarById(db, id, lineAccountId);
}

export async function deleteCommonVar(db: D1Database, id: string, lineAccountId: string): Promise<void> {
  await db.prepare(`DELETE FROM common_vars WHERE id = ? AND line_account_id = ?`).bind(id, lineAccountId).run();
}

/** 差し込み用に key => value でまとめて返す。 */
export async function getCommonVarMap(
  db: D1Database,
  lineAccountId: string | null | undefined,
): Promise<Record<string, string>> {
  if (!lineAccountId) return {};
  const result = await db
    .prepare(`SELECT var_key, value FROM common_vars WHERE line_account_id = ?`)
    .bind(lineAccountId)
    .all<{ var_key: string; value: string }>();
  const out: Record<string, string> = {};
  for (const row of result.results) out[row.var_key] = row.value;
  return out;
}

// --- 日付での切り替え ---------------------------------------------------

export async function getCommonVarSchedules(
  db: D1Database,
  varId: string,
): Promise<CommonVarSchedule[]> {
  const result = await db
    .prepare(
      `SELECT * FROM common_var_schedules WHERE var_id = ? ORDER BY effective_from ASC`,
    )
    .bind(varId)
    .all<CommonVarSchedule>();
  return result.results;
}

export async function createCommonVarSchedule(
  db: D1Database,
  input: { varId: string; effectiveFrom: string; value: string },
): Promise<CommonVarSchedule> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO common_var_schedules (id, var_id, effective_from, value, applied_at)
       VALUES (?, ?, ?, ?, NULL)`,
    )
    .bind(id, input.varId, input.effectiveFrom, input.value)
    .run();
  return (await db
    .prepare(`SELECT * FROM common_var_schedules WHERE id = ?`)
    .bind(id)
    .first<CommonVarSchedule>())!;
}

export async function deleteCommonVarSchedule(
  db: D1Database,
  id: string,
  varId: string,
): Promise<void> {
  await db.prepare(`DELETE FROM common_var_schedules WHERE id = ? AND var_id = ?`).bind(id, varId).run();
}

/**
 * 予約した切り替えを反映する。Cron から呼ぶ。
 *
 * applied_at が NULL の行だけを見るので、二度反映されない。
 * 同じ変数に複数の予約が溜まっている場合は古い順に当て、最後のものが残る。
 * 途中を飛ばすと「一度も適用されなかった値」が残るので、順番に当てる。
 */
export async function applyDueCommonVarSchedules(
  db: D1Database,
  now: string,
): Promise<number> {
  const due = await db
    .prepare(
      `SELECT * FROM common_var_schedules
        WHERE applied_at IS NULL AND effective_from <= ?
        ORDER BY effective_from ASC`,
    )
    .bind(now)
    .all<CommonVarSchedule>();
  let applied = 0;
  for (const row of due.results) {
    await db
      .prepare(`UPDATE common_vars SET value = ?, updated_at = ? WHERE id = ?`)
      .bind(row.value, jstNow(), row.var_id)
      .run();
    await db
      .prepare(`UPDATE common_var_schedules SET applied_at = ? WHERE id = ?`)
      .bind(jstNow(), row.id)
      .run();
    applied++;
  }
  return applied;
}
