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
}

export type CommonVarUsageKind =
  | 'template'
  | 'broadcast'
  | 'scenario'
  | 'reminder'
  | 'auto_reply'
  | 'form'
  | 'automation';

export interface CommonVarUsageImpact {
  total: number;
  /** 過去に送り終わった配信を除き、値の変更で影響する場所。 */
  blockingTotal: number;
  /** 過去に送信済みで、値を変えても表示内容が変わらない記録。 */
  historicalTotal: number;
  /** forms はまだアカウント所属を持たないため、名前や本文を見せず件数だけ返す。 */
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
  source_column: string;
  source_content: string;
  /** 送信済み配信のように、過去の表示が変わらない記録。 */
  is_historical: number;
}

const COMMON_VAR_USAGE_QUERIES: Array<{
  kind: CommonVarUsageKind;
  sql: string;
  selectTokenBinds: number;
  whereTokenBinds: number;
}> = [
  {
    kind: 'template', selectTokenBinds: 0, whereTokenBinds: 1,
    sql: `SELECT t.id AS source_id, NULL AS source_parent_id, t.name AS source_name, 'active' AS source_status,
                 'message_content' AS source_column, t.message_content AS source_content,
                 0 AS is_historical
            FROM templates t
           WHERE t.line_account_id = ? AND instr(coalesce(t.message_content, ''), ?) > 0`,
  },
  {
    kind: 'broadcast', selectTokenBinds: 0, whereTokenBinds: 1,
    sql: `SELECT b.id AS source_id, NULL AS source_parent_id, b.title AS source_name, b.status AS source_status,
                 'message_content' AS source_column, b.message_content AS source_content,
                 CASE WHEN b.status = 'sent' THEN 1 ELSE 0 END AS is_historical
            FROM broadcasts b
           WHERE b.line_account_id = ? AND instr(coalesce(b.message_content, ''), ?) > 0`,
  },
  {
    kind: 'scenario', selectTokenBinds: 2, whereTokenBinds: 2,
    sql: `SELECT ss.id AS source_id, s.id AS source_parent_id,
                 s.name || '・' || CAST(ss.step_order AS TEXT) || '通目' AS source_name,
                 CASE WHEN s.is_active = 1 THEN 'active' ELSE 'stopped' END AS source_status,
                 CASE WHEN instr(coalesce(ss.message_content, ''), ?) > 0
                      THEN 'message_content' ELSE 'message_bubbles_json' END AS source_column,
                 CASE WHEN instr(coalesce(ss.message_content, ''), ?) > 0
                      THEN ss.message_content ELSE coalesce(ss.message_bubbles_json, '') END AS source_content,
                 0 AS is_historical
            FROM scenario_steps ss JOIN scenarios s ON s.id = ss.scenario_id
           WHERE s.line_account_id = ?
             AND (instr(coalesce(ss.message_content, ''), ?) > 0
               OR instr(coalesce(ss.message_bubbles_json, ''), ?) > 0)`,
  },
  {
    kind: 'reminder', selectTokenBinds: 0, whereTokenBinds: 1,
    sql: `SELECT rs.id AS source_id, r.id AS source_parent_id, r.name AS source_name,
                 CASE WHEN r.is_active = 1 THEN 'active' ELSE 'stopped' END AS source_status,
                 'message_content' AS source_column, rs.message_content AS source_content,
                 0 AS is_historical
            FROM reminder_steps rs JOIN reminders r ON r.id = rs.reminder_id
           WHERE r.line_account_id = ? AND instr(coalesce(rs.message_content, ''), ?) > 0`,
  },
  {
    kind: 'auto_reply', selectTokenBinds: 2, whereTokenBinds: 2,
    sql: `SELECT ar.id AS source_id, NULL AS source_parent_id, coalesce(nullif(ar.name, ''), ar.keyword) AS source_name,
                 CASE WHEN ar.is_active = 1 THEN 'active' ELSE 'stopped' END AS source_status,
                 CASE WHEN instr(coalesce(ar.response_content, ''), ?) > 0
                      THEN 'response_content' ELSE 'actions_json' END AS source_column,
                 CASE WHEN instr(coalesce(ar.response_content, ''), ?) > 0
                      THEN ar.response_content ELSE coalesce(ar.actions_json, '') END AS source_content,
                 0 AS is_historical
            FROM auto_replies ar
           WHERE ar.line_account_id = ?
             AND (instr(coalesce(ar.response_content, ''), ?) > 0
               OR instr(coalesce(ar.actions_json, ''), ?) > 0)`,
  },
  {
    kind: 'automation', selectTokenBinds: 2, whereTokenBinds: 2,
    sql: `SELECT a.id AS source_id, NULL AS source_parent_id, a.name AS source_name,
                 CASE WHEN a.is_active = 1 THEN 'active' ELSE 'stopped' END AS source_status,
                 CASE WHEN instr(coalesce(a.conditions, ''), ?) > 0
                      THEN 'conditions' ELSE 'actions' END AS source_column,
                 CASE WHEN instr(coalesce(a.conditions, ''), ?) > 0
                      THEN a.conditions ELSE coalesce(a.actions, '') END AS source_content,
                 0 AS is_historical
            FROM automations a
           WHERE a.line_account_id = ?
             AND (instr(coalesce(a.conditions, ''), ?) > 0
               OR instr(coalesce(a.actions, ''), ?) > 0)`,
  },
];

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
    const values = [
      ...Array.from({ length: source.selectTokenBinds }, () => token),
      lineAccountId,
      ...Array.from({ length: source.whereTokenBinds }, () => token),
    ];
    const result = await db.prepare(source.sql).bind(...values).all<Omit<CommonVarUsageItem, 'kind'>>();
    const found = result.results.map((item) => ({ ...item, kind: source.kind }));
    items.push(...found);
    byKind[source.kind] = found.length;
  }

  // forms は line_account_id をまだ持たない。別アカウントのフォーム名や本文を
  // 画面へ出さず、削除だけは安全側に止めるため、一致件数だけを数える。
  const unscopedForms = await db.prepare(
    `SELECT COUNT(*) AS count FROM forms
      WHERE instr(coalesce(on_submit_message_content, ''), ?) > 0
         OR instr(coalesce(fields, ''), ?) > 0
         OR instr(coalesce(layout, ''), ?) > 0`,
  ).bind(token, token, token).first<{ count: number }>();
  const unscopedFormTotal = Number(unscopedForms?.count ?? 0);
  byKind.form = unscopedFormTotal;

  const historicalTotal = items.filter((item) => item.is_historical === 1).length;
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
