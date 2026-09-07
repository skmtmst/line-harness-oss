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
  memo: string;
  version: number;
  updated_by: string | null;
  archived_at: string | null;
  replacement_run_id: string | null;
  created_at: string;
  updated_at: string;
  /** 一覧用。未反映の次回予約を一覧APIでまとめて返し、行ごとのAPI呼出を避ける。 */
  next_effective_from?: string | null;
  next_value?: string | null;
  pending_schedule_count?: number;
  /** 一覧用。現在・過去を含め、差し込まれている場所の合計。 */
  usage_count?: number;
  usage_by_kind?: Record<CommonVarUsageKind, number>;
}

export interface CommonVarVersion {
  id: string;
  common_var_id: string;
  version_no: number;
  name: string;
  value: string;
  memo: string;
  change_reason: string;
  actor_id: string | null;
  actor_name: string | null;
  created_at: string;
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

const COMMON_VAR_USAGE_SUMMARY_SQL = `SELECT
  ${COMMON_VAR_USAGE_QUERIES.map((source) =>
    `(SELECT COUNT(*) FROM (${source.sql})) AS ${source.kind}`).join(',\n  ')},
  (SELECT COUNT(*) FROM forms f
    WHERE NOT EXISTS (SELECT 1 FROM form_accounts fa WHERE fa.form_id = f.id)
      AND (instr(coalesce(f.on_submit_message_content, ''), ?) > 0
        OR instr(coalesce(f.fields, ''), ?) > 0
        OR instr(coalesce(f.layout, ''), ?) > 0)) AS unscoped_form`;

export interface CommonVarUsageSummary {
  total: number;
  byKind: Record<CommonVarUsageKind, number>;
}

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
  const summaries = await getCommonVarUsageSummaries(db, varKeys, lineAccountId);
  return new Map([...summaries].map(([key, summary]) => [key, summary.total]));
}

/** 一覧1回で、合計だけでなくテンプレート・配信等の種類別件数も返す。 */
export async function getCommonVarUsageSummaries(
  db: D1Database,
  varKeys: string[],
  lineAccountId: string,
): Promise<Map<string, CommonVarUsageSummary>> {
  const uniqueKeys = [...new Set(varKeys)];
  const summaries = new Map<string, CommonVarUsageSummary>();
  const batchSize = 80;

  for (let offset = 0; offset < uniqueKeys.length; offset += batchSize) {
    const keys = uniqueKeys.slice(offset, offset + batchSize);
    const statements = keys.map((varKey) => {
      const token = `{{var.${varKey}}}`;
      const values = COMMON_VAR_USAGE_QUERIES.flatMap((source) =>
        source.values(varKey, token, lineAccountId));
      return db.prepare(COMMON_VAR_USAGE_SUMMARY_SQL)
        .bind(...values, token, token, token);
    });
    const results = await db.batch<Record<CommonVarUsageKind, number> & { unscoped_form: number }>(statements);
    keys.forEach((varKey, index) => {
      const row = results[index]?.results[0];
      const byKind = Object.fromEntries(COMMON_VAR_USAGE_QUERIES.map(({ kind }) => [
        kind,
        Number(row?.[kind] ?? 0) + (kind === 'form' ? Number(row?.unscoped_form ?? 0) : 0),
      ])) as Record<CommonVarUsageKind, number>;
      summaries.set(varKey, {
        total: Object.values(byKind).reduce((sum, count) => sum + count, 0),
        byKind,
      });
    });
  }

  return summaries;
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
      .prepare(`SELECT common_vars.* ${overview} FROM common_vars WHERE line_account_id = ? AND archived_at IS NULL AND folder_id = ? ORDER BY name ASC`)
      .bind(opts.lineAccountId, opts.folderId)
      .all<CommonVar>();
    return result.results;
  }
  const result = await db
    .prepare(`SELECT common_vars.* ${overview} FROM common_vars WHERE line_account_id = ? AND archived_at IS NULL ORDER BY name ASC`)
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
  return db.prepare(`SELECT * FROM common_vars WHERE id = ? AND line_account_id = ? AND archived_at IS NULL`)
    .bind(id, lineAccountId).first<CommonVar>();
}

export class CommonVarVersionConflictError extends Error {
  constructor(readonly currentVersion: number) {
    super('Common variable version conflict');
  }
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
    memo?: string;
    actorId?: string | null;
  },
): Promise<CommonVar> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const memo = input.memo ?? '';
  const value = input.value ?? '';
  await db.batch([
    db.prepare(
      `INSERT INTO common_vars
         (id, line_account_id, folder_id, name, var_key, type, value, memo, version,
          updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    ).bind(
      id, input.lineAccountId, input.folderId ?? null, input.name, input.varKey,
      input.type ?? 'text', value, memo, input.actorId ?? null, now, now,
    ),
    db.prepare(
      `INSERT INTO common_var_versions
         (id, common_var_id, version_no, name, value, memo, change_reason, actor_id, created_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), id, input.name, value, memo, '作成', input.actorId ?? null, now,
    ),
  ]);
  return (await getCommonVarById(db, id, input.lineAccountId))!;
}

export async function updateCommonVar(
  db: D1Database,
  id: string,
  lineAccountId: string,
  input: {
    name?: string;
    value?: string;
    memo?: string;
    folderId?: string | null;
    expectedVersion?: number;
    actorId?: string | null;
    changeReason?: string;
  },
): Promise<CommonVar | null> {
  const existing = await getCommonVarById(db, id, lineAccountId);
  if (!existing) return null;
  if (input.expectedVersion !== undefined && input.expectedVersion !== existing.version) {
    throw new CommonVarVersionConflictError(existing.version);
  }
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
  if (input.memo !== undefined) {
    sets.push('memo = ?');
    values.push(input.memo);
  }
  if ('folderId' in input) {
    sets.push('folder_id = ?');
    values.push(input.folderId ?? null);
  }
  if (sets.length > 0) {
    const now = jstNow();
    const nextVersion = existing.version + 1;
    sets.push('version = ?', 'updated_by = ?', 'updated_at = ?');
    values.push(nextVersion, input.actorId ?? null, now, id, lineAccountId, existing.version);
    const results = await db.batch([
      db.prepare(
        `UPDATE common_vars SET ${sets.join(', ')}
          WHERE id = ? AND line_account_id = ? AND version = ? AND archived_at IS NULL`,
      ).bind(...values),
      db.prepare(
        `INSERT INTO common_var_versions
           (id, common_var_id, version_no, name, value, memo, change_reason, actor_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(), id, nextVersion,
        input.name ?? existing.name,
        input.value ?? existing.value,
        input.memo ?? existing.memo,
        input.changeReason?.trim() || '編集',
        input.actorId ?? null,
        now,
      ),
    ]);
    if (Number(results[0]?.meta.changes ?? 0) === 0) {
      throw new CommonVarVersionConflictError(
        (await getCommonVarById(db, id, lineAccountId))?.version ?? existing.version,
      );
    }
  }
  return getCommonVarById(db, id, lineAccountId);
}

export async function getCommonVarVersions(
  db: D1Database,
  commonVarId: string,
  lineAccountId: string,
  limit = 20,
): Promise<CommonVarVersion[]> {
  const result = await db.prepare(
    `SELECT v.*, sm.name AS actor_name
       FROM common_var_versions v
       JOIN common_vars cv ON cv.id = v.common_var_id
       LEFT JOIN staff_members sm ON sm.id = v.actor_id
      WHERE v.common_var_id = ? AND cv.line_account_id = ?
      ORDER BY v.version_no DESC
      LIMIT ?`,
  ).bind(commonVarId, lineAccountId, Math.max(1, Math.min(limit, 100))).all<CommonVarVersion>();
  return result.results;
}

export async function deleteCommonVar(db: D1Database, id: string, lineAccountId: string): Promise<void> {
  await db.prepare(`DELETE FROM common_vars WHERE id = ? AND line_account_id = ?`).bind(id, lineAccountId).run();
}

export interface CommonVarReplacementTarget {
  table: string;
  id: string;
  kind: CommonVarUsageKind;
  columns: Record<string, string>;
  originalColumns: Record<string, string>;
  fingerprint: string;
}

export interface CommonVarReplacementPlan {
  source: CommonVar;
  replacement: CommonVar;
  targets: CommonVarReplacementTarget[];
  usageTotal: number;
  replaceableTotal: number;
  blockedTotal: number;
  historicalTotal: number;
  unscopedFormTotal: number;
}

type ReplacementSource = {
  table: string;
  kind: CommonVarUsageKind;
  columns: string[];
  sql: string;
};

const COMMON_VAR_REPLACEMENT_SOURCES: ReplacementSource[] = [
  { table: 'templates', kind: 'template', columns: ['message_content', 'question_json', 'carousel_actions_json'], sql: `SELECT id, message_content, question_json, carousel_actions_json FROM templates WHERE line_account_id = ?` },
  { table: 'broadcasts', kind: 'broadcast', columns: ['message_content', 'message_bubbles_json'], sql: `SELECT id, message_content, message_bubbles_json FROM broadcasts WHERE status != 'sent' AND (line_account_id = ? OR EXISTS (SELECT 1 FROM json_each(coalesce(account_ids, '[]')) WHERE value = ?))` },
  { table: 'scenario_steps', kind: 'scenario', columns: ['message_content', 'message_bubbles_json', 'question_json'], sql: `SELECT ss.id, ss.message_content, ss.message_bubbles_json, ss.question_json FROM scenario_steps ss JOIN scenarios s ON s.id = ss.scenario_id WHERE s.line_account_id = ?` },
  { table: 'scenario_actions', kind: 'scenario', columns: ['config_json'], sql: `SELECT sa.id, sa.config_json FROM scenario_actions sa JOIN scenarios s ON s.id = sa.scenario_id WHERE s.line_account_id = ? AND sa.action_type = 'common_var'` },
  { table: 'reminder_steps', kind: 'reminder', columns: ['message_content'], sql: `SELECT rs.id, rs.message_content FROM reminder_steps rs JOIN reminders r ON r.id = rs.reminder_id WHERE r.line_account_id = ?` },
  { table: 'auto_replies', kind: 'auto_reply', columns: ['response_content', 'actions_json'], sql: `SELECT id, response_content, actions_json FROM auto_replies WHERE line_account_id = ?` },
  { table: 'forms', kind: 'form', columns: ['on_submit_message_content', 'fields', 'layout'], sql: `SELECT DISTINCT f.id, f.on_submit_message_content, f.fields, f.layout FROM forms f JOIN form_accounts fa ON fa.form_id = f.id WHERE fa.line_account_id = ?` },
  { table: 'automations', kind: 'automation', columns: ['conditions', 'actions'], sql: `SELECT id, conditions, actions FROM automations WHERE line_account_id = ?` },
  { table: 'automation_versions', kind: 'automation', columns: ['trigger_config', 'condition_config', 'action_config'], sql: `SELECT v.id, v.trigger_config, v.condition_config, v.action_config FROM automation_versions v JOIN automation_definitions d ON d.id = v.automation_id WHERE d.line_account_id = ? AND v.id IN (d.current_draft_version_id, d.current_published_version_id)` },
  { table: 'account_settings', kind: 'friend_add', columns: ['value'], sql: `SELECT id, value FROM account_settings WHERE line_account_id = ? AND key = 'friend_add_routing'` },
  { table: 'common_action_versions', kind: 'common_action', columns: ['action_config'], sql: `SELECT v.id, v.action_config FROM common_action_versions v JOIN common_actions a ON a.id = v.common_action_id WHERE a.line_account_id = ? AND v.id IN (a.current_draft_version_id, a.current_published_version_id)` },
];

function replaceStructuredCommonVar(value: unknown, sourceKey: string, replacementKey: string): boolean {
  let changed = false;
  if (Array.isArray(value)) {
    for (const item of value) changed = replaceStructuredCommonVar(item, sourceKey, replacementKey) || changed;
    return changed;
  }
  if (!value || typeof value !== 'object') return false;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'varKey' && item === sourceKey) {
      (value as Record<string, unknown>)[key] = replacementKey;
      changed = true;
    } else {
      changed = replaceStructuredCommonVar(item, sourceKey, replacementKey) || changed;
    }
  }
  return changed;
}

function replaceCommonVarText(text: string, sourceKey: string, replacementKey: string): string | null {
  const sourceToken = `{{var.${sourceKey}}}`;
  const replacementToken = `{{var.${replacementKey}}}`;
  let next = text.replaceAll(sourceToken, replacementToken);
  let structuredChanged = false;
  try {
    const parsed = JSON.parse(next) as unknown;
    structuredChanged = replaceStructuredCommonVar(parsed, sourceKey, replacementKey);
    if (structuredChanged) next = JSON.stringify(parsed);
  } catch {
    // 通常本文はJSONではない。厳密な従来トークンだけを置換する。
  }
  return next !== text || structuredChanged ? next : null;
}

function replacementQueryValues(source: ReplacementSource, accountId: string): string[] {
  return source.table === 'broadcasts' ? [accountId, accountId] : [accountId];
}

export async function getCommonVarReplacementCandidates(
  db: D1Database,
  source: CommonVar,
): Promise<CommonVar[]> {
  const result = await db.prepare(
    `SELECT * FROM common_vars
      WHERE line_account_id = ? AND id != ? AND type = ? AND archived_at IS NULL
      ORDER BY name ASC, id ASC`,
  ).bind(source.line_account_id, source.id, source.type).all<CommonVar>();
  return result.results;
}

export async function getCommonVarReplacementPlan(
  db: D1Database,
  source: CommonVar,
  replacement: CommonVar,
): Promise<CommonVarReplacementPlan> {
  if (!source.line_account_id || source.line_account_id !== replacement.line_account_id
    || source.type !== replacement.type || source.id === replacement.id) {
    throw new Error('Incompatible common variable replacement');
  }
  const targets: CommonVarReplacementTarget[] = [];
  for (const descriptor of COMMON_VAR_REPLACEMENT_SOURCES) {
    const result = await db.prepare(descriptor.sql)
      .bind(...replacementQueryValues(descriptor, source.line_account_id))
      .all<Record<string, string | null>>();
    for (const row of result.results) {
      const columns: Record<string, string> = {};
      const originalColumns: Record<string, string> = {};
      const before: string[] = [];
      for (const column of descriptor.columns) {
        const current = row[column];
        if (typeof current !== 'string') continue;
        const next = replaceCommonVarText(current, source.var_key, replacement.var_key);
        if (next !== null) {
          columns[column] = next;
          originalColumns[column] = current;
          before.push(`${column}:${current}`);
        }
      }
      if (Object.keys(columns).length > 0) {
        targets.push({
          table: descriptor.table,
          id: String(row.id),
          kind: descriptor.kind,
          columns,
          originalColumns,
          fingerprint: before.join('\n'),
        });
      }
    }
  }
  const impact = await getCommonVarUsageImpact(db, source.var_key, source.line_account_id);
  const blockedTotal = Math.max(0, impact.blockingTotal - targets.length);
  return {
    source,
    replacement,
    targets,
    usageTotal: impact.total,
    replaceableTotal: targets.length,
    blockedTotal,
    historicalTotal: impact.historicalTotal,
    unscopedFormTotal: impact.unscopedFormTotal,
  };
}

export async function applyCommonVarReplacementPlan(
  db: D1Database,
  plan: CommonVarReplacementPlan,
  actorId: string | null,
): Promise<{ runId: string; replacedUsageCount: number; archivedVersion: number }> {
  if (!plan.source.line_account_id || plan.blockedTotal > 0) {
    throw new Error('Common variable replacement is blocked');
  }
  const now = jstNow();
  const runId = crypto.randomUUID();
  const archivedVersion = plan.source.version + 1;
  const assertions = plan.targets.map((target) => {
    const originals = Object.entries(target.originalColumns);
    return db.prepare(
      `SELECT CASE WHEN EXISTS (
         SELECT 1 FROM ${target.table}
          WHERE id = ? AND ${originals.map(([column]) => `${column} IS ?`).join(' AND ')}
       ) THEN 1 ELSE json('') END AS unchanged`,
    ).bind(target.id, ...originals.map(([, value]) => value));
  });
  const updates = plan.targets.map((target) => {
    const entries = Object.entries(target.columns);
    const originals = Object.entries(target.originalColumns);
    return db.prepare(
      `UPDATE ${target.table}
          SET ${entries.map(([column]) => `${column} = ?`).join(', ')}
        WHERE id = ? AND ${originals.map(([column]) => `${column} IS ?`).join(' AND ')}
          AND EXISTS (
          SELECT 1 FROM common_vars
           WHERE id = ? AND replacement_run_id = ? AND version = ?
        )`,
    ).bind(
      ...entries.map(([, value]) => value), target.id,
      ...originals.map(([, value]) => value),
      plan.source.id, runId, archivedVersion,
    );
  });
  const results = await db.batch([
    ...assertions,
    db.prepare(
      `UPDATE common_vars
          SET archived_at = ?, replacement_run_id = ?, version = ?, updated_by = ?, updated_at = ?
        WHERE id = ? AND line_account_id = ? AND version = ? AND archived_at IS NULL`,
    ).bind(
      now, runId, archivedVersion, actorId, now, plan.source.id,
      plan.source.line_account_id, plan.source.version,
    ),
    ...updates,
    db.prepare(
      `INSERT INTO common_var_versions
         (id, common_var_id, version_no, name, value, memo, change_reason, actor_id, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM common_vars
           WHERE id = ? AND replacement_run_id = ? AND version = ?
        )`,
    ).bind(
      crypto.randomUUID(), plan.source.id, archivedVersion, plan.source.name,
      plan.source.value, plan.source.memo, `「${plan.replacement.name}」へ差し替えてアーカイブ`,
      actorId, now, plan.source.id, runId, archivedVersion,
    ),
    db.prepare(
      `INSERT INTO common_var_replacement_runs
         (id, line_account_id, source_common_var_id, replacement_common_var_id,
          source_version, expected_usage_count, replaced_usage_count, actor_id, status, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?
        WHERE EXISTS (
          SELECT 1 FROM common_vars
           WHERE id = ? AND replacement_run_id = ? AND version = ?
        )`,
    ).bind(
      runId, plan.source.line_account_id, plan.source.id, plan.replacement.id,
      plan.source.version, plan.replaceableTotal, plan.replaceableTotal, actorId, now,
      plan.source.id, runId, archivedVersion,
    ),
  ]);
  const archiveResult = results[assertions.length];
  if (Number(archiveResult?.meta.changes ?? 0) === 0) {
    throw new CommonVarVersionConflictError(plan.source.version);
  }
  return { runId, replacedUsageCount: plan.replaceableTotal, archivedVersion };
}

/** 差し込み用に key => value でまとめて返す。 */
export async function getCommonVarMap(
  db: D1Database,
  lineAccountId: string | null | undefined,
): Promise<Record<string, string>> {
  if (!lineAccountId) return {};
  const result = await db
    .prepare(`SELECT var_key, value FROM common_vars WHERE line_account_id = ? AND archived_at IS NULL`)
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
  limit = 1_000,
): Promise<number> {
  const batchLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(Math.trunc(limit), 1_000))
    : 1_000;
  const due = await db
    .prepare(
      `SELECT * FROM common_var_schedules
        WHERE applied_at IS NULL AND effective_from <= ?
        ORDER BY effective_from ASC, id ASC
        LIMIT ?`,
    )
    .bind(now, batchLimit)
    .all<CommonVarSchedule>();
  let applied = 0;
  for (const row of due.results) {
    // 適用のたびに版を1つ進め、履歴に1行残す。値・版・履歴・適用済み印を
    // 同じ batch にして、途中で落ちたら「値だけ変わって記録なし」にしない。
    // 版の一致を条件に入れるので、利用者の同時編集とぶつかった回は
    // 何も書かず、次回の Cron で当て直す。
    const current = await db
      .prepare(
        `SELECT name, value, memo, version FROM common_vars
          WHERE id = ? AND archived_at IS NULL`,
      )
      .bind(row.var_id)
      .first<{ name: string; value: string; memo: string | null; version: number }>();
    const stamp = jstNow();
    if (!current) {
      // 変数自体が無い(削除済み等)の予約は、繰り返し拾わないよう印だけ打つ。
      await db
        .prepare(`UPDATE common_var_schedules SET applied_at = ? WHERE id = ?`)
        .bind(stamp, row.id)
        .run();
      applied++;
      continue;
    }
    const nextVersion = current.version + 1;
    const results = await db.batch([
      // SELECT後からbatch開始までに画面保存が入っていたら、意図的にSQLエラーを
      // 起こしてbatch全体を戻す。batch内は同一トランザクションなので、この確認後に
      // 値・履歴・適用済み印が分かれることはない。
      db.prepare(
        `SELECT CASE WHEN EXISTS (
           SELECT 1 FROM common_vars
            WHERE id = ? AND version = ? AND archived_at IS NULL
         ) THEN 1 ELSE json('') END AS version_is_current`,
      ).bind(row.var_id, current.version),
      db.prepare(
        `UPDATE common_vars SET value = ?, version = ?, updated_by = NULL, updated_at = ?
          WHERE id = ? AND version = ? AND archived_at IS NULL`,
      ).bind(row.value, nextVersion, stamp, row.var_id, current.version),
      db.prepare(
        `INSERT INTO common_var_versions
           (id, common_var_id, version_no, name, value, memo, change_reason, actor_id, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM common_vars
             WHERE id = ? AND version = ? AND archived_at IS NULL
          )`,
      ).bind(
        crypto.randomUUID(), row.var_id, nextVersion,
        current.name, row.value, current.memo ?? '',
        '予約適用', null, stamp,
        row.var_id, nextVersion,
      ),
      db.prepare(
        `UPDATE common_var_schedules SET applied_at = ?
          WHERE id = ? AND applied_at IS NULL AND EXISTS (
            SELECT 1 FROM common_vars
             WHERE id = ? AND version = ? AND archived_at IS NULL
          )`,
      ).bind(stamp, row.id, row.var_id, nextVersion),
    ]);
    if ((results[1].meta?.changes ?? 0) > 0) applied++;
  }
  return applied;
}
