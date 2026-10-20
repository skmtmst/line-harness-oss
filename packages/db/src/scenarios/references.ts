import { type AccountScopedResource, type ActionReferenceCheck, type ScenarioReferenceMismatch } from './types.js';


export const ACCOUNT_SCOPED_TABLES: Record<AccountScopedResource, string> = {
  tag: 'tags',
  template: 'templates',
  scenario: 'scenarios',
};

/**
 * 参照資源が、そのシナリオと同じ LINE 公式アカウントのものか。
 *
 * - シナリオ側が共通（NULL）なら確かめない → true
 * - 資源が見つからないときは false（消された ID を黙って使わない）
 * - 資源側が共通（NULL）なら true
 */
export async function isResourceInScenarioAccount(
  db: D1Database,
  resource: AccountScopedResource,
  resourceId: string | null | undefined,
  scenarioAccountId: string | null,
): Promise<boolean> {
  if (!resourceId) return true;
  if (!scenarioAccountId) return true;
  const table = ACCOUNT_SCOPED_TABLES[resource];
  const row = await db
    .prepare(`SELECT line_account_id AS account_id FROM ${table} WHERE id = ?`)
    .bind(resourceId)
    .first<{ account_id: string | null }>();
  if (!row) return false;
  return row.account_id === null || row.account_id === scenarioAccountId;
}

// 176: tenant_id 未設定の既存行は既定統括に属する。support-marks.ts と同じ値。
export const SCENARIO_LEGACY_TENANT_ID = '00000000-0000-4000-8000-000000000001';

export async function resourceExists(db: D1Database, table: string, id: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT id FROM ${table} WHERE id = ?`)
    .bind(id)
    .first<{ id: string }>();
  return !!row;
}

/**
 * N-053: アクション保存前の参照検証。存在しない参照・別アカウント参照を弾く。
 *
 * #644 の既存契約に合わせる。シナリオ側が共通（NULL）なら確かめない。
 * 資源側の共通（NULL）は tag/template/scenario の3種だけ通し、それ以外へは
 * 推測で広げない。通すのは「ある」だけでなく「そのシナリオで使える」行だけ。
 * 書き込みはしない。呼び側が保存の前に呼ぶ。
 */
export async function validateScenarioActionReferences(
  db: D1Database,
  scenarioAccountId: string | null,
  actionType: string,
  config: unknown,
): Promise<ActionReferenceCheck> {
  if (!scenarioAccountId) return { ok: true };
  const c = (typeof config === 'object' && config !== null && !Array.isArray(config))
    ? config as Record<string, unknown>
    : {};
  const nonEmpty = (value: unknown): value is string =>
    typeof value === 'string' && value !== '';

  // シナリオ側の統括。未設定の既存行は既定統括（176・283 と同じ扱い）。
  const accountRow = await db
    .prepare(`SELECT tenant_id AS tenant_id FROM line_accounts WHERE id = ?`)
    .bind(scenarioAccountId)
    .first<{ tenant_id: string | null }>();
  const scenarioTenantId = accountRow?.tenant_id ?? SCENARIO_LEGACY_TENANT_ID;

  const scoped = async (
    table: 'tags' | 'scenarios' | 'templates' | 'reminders',
    label: string,
    field: string,
    id: string,
    opts: { skipDeleted?: boolean } = {},
  ): Promise<ActionReferenceCheck> => {
    const deleted = opts.skipDeleted ? ' AND deleted_at IS NULL' : '';
    const row = await db
      .prepare(`SELECT line_account_id AS account_id FROM ${table} WHERE id = ?${deleted}`)
      .bind(id)
      .first<{ account_id: string | null }>();
    if (!row) {
      return { ok: false, issue: { field, reason: 'missing', message: `${label}が見つかりません。選び直してください。` } };
    }
    if (row.account_id === null || row.account_id === scenarioAccountId) return { ok: true };
    return { ok: false, issue: { field, reason: 'cross-account', message: `別のLINEアカウントの${label}は使えません。` } };
  };

  /**
   * N-053 R2: 範囲表つき資源（対応マーク・友だち情報欄）の所有境界。
   * 可視条件は各機能の取得口と同一にする（support-marks.ts・friend-fields.ts）。
   * 範囲表が無い昔の行は既定統括の共通扱い（196・198 と同じ扱い）。
   */
  const tenantScoped = async (
    table: 'support_marks' | 'friend_fields',
    scopeTable: 'support_mark_scopes' | 'friend_field_scopes',
    scopeColumn: 'mark_id' | 'field_id',
    statusColumn: 'archived_at' | 'status',
    label: string,
    field: string,
    id: string,
  ): Promise<ActionReferenceCheck> => {
    const statusGuard = statusColumn === 'archived_at'
      ? 'AND t.archived_at IS NULL'
      : `AND t.status != 'archived'`;
    const usable = await db
      .prepare(
        `SELECT t.id AS id
           FROM ${table} t
           LEFT JOIN ${scopeTable} s ON s.${scopeColumn} = t.id
          WHERE t.id = ? ${statusGuard}
            AND COALESCE(s.tenant_id, '${SCENARIO_LEGACY_TENANT_ID}') = ?
            AND (s.line_account_id = ? OR s.line_account_id IS NULL)`,
      )
      .bind(id, scenarioTenantId, scenarioAccountId)
      .first<{ id: string }>();
    if (usable) return { ok: true };
    const row = await db
      .prepare(
        statusColumn === 'archived_at'
          ? `SELECT id, archived_at AS retired FROM ${table} WHERE id = ?`
          : `SELECT id, status AS retired FROM ${table} WHERE id = ?`,
      )
      .bind(id)
      .first<{ id: string; retired: string | null }>();
    // 行が無い・捨てた行は幽霊扱い（捨てたイベント・共通情報と同じ）。
    const retired = !row || (statusColumn === 'archived_at' ? row.retired !== null : row.retired === 'archived');
    if (retired) {
      return { ok: false, issue: { field, reason: 'missing', message: `${label}が見つかりません。選び直してください。` } };
    }
    const scope = await db
      .prepare(`SELECT tenant_id, line_account_id FROM ${scopeTable} WHERE ${scopeColumn} = ?`)
      .bind(id)
      .first<{ tenant_id: string; line_account_id: string | null }>();
    const ownerTenant = scope?.tenant_id ?? SCENARIO_LEGACY_TENANT_ID;
    if (ownerTenant !== scenarioTenantId) {
      return { ok: false, issue: { field, reason: 'cross-tenant', message: `別の統括の${label}は使えません。` } };
    }
    return { ok: false, issue: { field, reason: 'cross-account', message: `別のLINEアカウントの${label}は使えません。` } };
  };

  const global = async (
    table: 'tag_groups' | 'friend_fields' | 'support_marks' | 'reminders',
    label: string,
    field: string,
    id: string,
  ): Promise<ActionReferenceCheck> => {
    if (await resourceExists(db, table, id)) return { ok: true };
    return { ok: false, issue: { field, reason: 'missing', message: `${label}が見つかりません。選び直してください。` } };
  };

  switch (actionType) {
    case 'tag': {
      if (Array.isArray(c.tagIds)) {
        for (let index = 0; index < c.tagIds.length; index += 1) {
          const tagId = (c.tagIds as unknown[])[index];
          if (typeof tagId !== 'string' || tagId === '') continue;
          const checked = await scoped('tags', 'タグ', `tagIds[${index}]`, tagId);
          if (!checked.ok) return checked;
        }
      }
      if (nonEmpty(c.folderId)) {
        return global('tag_groups', 'タグのフォルダ', 'folderId', c.folderId);
      }
      return { ok: true };
    }
    case 'friend_field':
      if (!nonEmpty(c.fieldId)) return { ok: true };
      return tenantScoped('friend_fields', 'friend_field_scopes', 'field_id', 'status', '友だち情報欄', 'fieldId', c.fieldId);
    case 'support_mark':
      if (c.markId === null || c.markId === undefined || c.markId === '') return { ok: true };
      if (typeof c.markId !== 'string') {
        return { ok: false, issue: { field: 'markId', reason: 'missing', message: '対応マークの指定が不正です。' } };
      }
      return tenantScoped('support_marks', 'support_mark_scopes', 'mark_id', 'archived_at', '対応マーク', 'markId', c.markId);
    case 'scenario':
      if (!nonEmpty(c.scenarioId)) return { ok: true };
      return scoped('scenarios', 'シナリオ', 'scenarioId', c.scenarioId);
    case 'common_var': {
      // 実行は (var_key, その友だちのアカウント, 未アーカイブ) の完全一致で読む。
      // 共通（NULL）行は実行で拾われないので、既存契約に無いものとして通さない。
      if (!nonEmpty(c.varKey)) return { ok: true };
      const row = await db
        .prepare(
          `SELECT id FROM common_vars
            WHERE var_key = ? AND line_account_id = ? AND archived_at IS NULL`,
        )
        .bind(c.varKey, scenarioAccountId)
        .first<{ id: string }>();
      if (row) return { ok: true };
      const other = await db
        .prepare(`SELECT id FROM common_vars WHERE var_key = ? AND archived_at IS NULL`)
        .bind(c.varKey)
        .first<{ id: string }>();
      if (other) {
        return { ok: false, issue: { field: 'varKey', reason: 'cross-account', message: '別のLINEアカウントの共通情報は使えません。' } };
      }
      return { ok: false, issue: { field: 'varKey', reason: 'missing', message: '共通情報が見つかりません。選び直してください。' } };
    }
    case 'send_message':
      return { ok: true };
    case 'send_template':
      if (!nonEmpty(c.templateId)) return { ok: true };
      return scoped('templates', 'テンプレート', 'templateId', c.templateId);
    case 'reminder':
      if (!nonEmpty(c.reminderId)) return { ok: true };
      return scoped('reminders', 'リマインダ', 'reminderId', c.reminderId, { skipDeleted: true });
    case 'event_booking': {
      if (!nonEmpty(c.eventId)) return { ok: true };
      const row = await db
        .prepare(`SELECT line_account_id AS account_id, deleted_at FROM events WHERE id = ?`)
        .bind(c.eventId)
        .first<{ account_id: string | null; deleted_at: string | null }>();
      if (!row || row.deleted_at !== null) {
        return { ok: false, issue: { field: 'eventId', reason: 'missing', message: 'イベントが見つかりません。選び直してください。' } };
      }
      if (row.account_id !== scenarioAccountId) {
        return { ok: false, issue: { field: 'eventId', reason: 'cross-account', message: '別のLINEアカウントのイベントは使えません。' } };
      }
      return { ok: true };
    }
    default:
      return { ok: false, issue: { field: '', reason: 'missing', message: `知らないアクション種別です: ${actionType}` } };
  }
}

/**
 * いま保存されている参照のうち、シナリオと別アカウントのものを洗い出す。
 *
 * 移行で消さない代わりに、運用が既存の不一致を一覧で確かめられるようにする。
 * 通の本文テンプレート・到達タグ・完了時の遷移先・アクションのタグと
 * テンプレートと遷移先を見る。
 */
export async function findScenarioReferenceMismatches(
  db: D1Database,
  scenarioId?: string,
): Promise<ScenarioReferenceMismatch[]> {
  const scenarios = scenarioId
    ? await db
        .prepare(`SELECT id, line_account_id FROM scenarios WHERE id = ?`)
        .bind(scenarioId)
        .all<{ id: string; line_account_id: string | null }>()
    : await db
        .prepare(`SELECT id, line_account_id FROM scenarios WHERE line_account_id IS NOT NULL`)
        .all<{ id: string; line_account_id: string | null }>();

  const out: ScenarioReferenceMismatch[] = [];
  for (const s of scenarios.results ?? []) {
    if (!s.line_account_id) continue;
    const check = async (
      resource: AccountScopedResource,
      resourceId: string | null,
      origin: string,
    ): Promise<void> => {
      if (!resourceId) return;
      if (await isResourceInScenarioAccount(db, resource, resourceId, s.line_account_id)) return;
      const row = await db
        .prepare(
          `SELECT line_account_id AS account_id FROM ${ACCOUNT_SCOPED_TABLES[resource]} WHERE id = ?`,
        )
        .bind(resourceId)
        .first<{ account_id: string | null }>();
      out.push({
        scenarioId: s.id,
        scenarioAccountId: s.line_account_id,
        resource,
        resourceId,
        resourceAccountId: row?.account_id ?? null,
        origin,
      });
    };

    const scenarioRow = await db
      .prepare(`SELECT on_complete_scenario_id FROM scenarios WHERE id = ?`)
      .bind(s.id)
      .first<{ on_complete_scenario_id: string | null }>();
    await check('scenario', scenarioRow?.on_complete_scenario_id ?? null, 'scenario.on_complete');

    const steps = await db
      .prepare(`SELECT id, template_id, on_reach_tag_id FROM scenario_steps WHERE scenario_id = ?`)
      .bind(s.id)
      .all<{ id: string; template_id: string | null; on_reach_tag_id: string | null }>();
    for (const step of steps.results ?? []) {
      await check('template', step.template_id, `step:${step.id}.template`);
      await check('tag', step.on_reach_tag_id, `step:${step.id}.on_reach_tag`);
    }

    const actions = await db
      .prepare(`SELECT id, action_type, config_json FROM scenario_actions WHERE scenario_id = ?`)
      .bind(s.id)
      .all<{ id: string; action_type: string; config_json: string }>();
    for (const action of actions.results ?? []) {
      let config: Record<string, unknown>;
      try {
        config = JSON.parse(action.config_json) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (action.action_type === 'tag' && Array.isArray(config['tagIds'])) {
        for (const tagId of config['tagIds'] as unknown[]) {
          if (typeof tagId === 'string') await check('tag', tagId, `action:${action.id}.tag`);
        }
      }
      if (action.action_type === 'send_template' && typeof config['templateId'] === 'string') {
        await check('template', config['templateId'] as string, `action:${action.id}.template`);
      }
      if (action.action_type === 'scenario' && typeof config['scenarioId'] === 'string') {
        await check('scenario', config['scenarioId'] as string, `action:${action.id}.scenario`);
      }
    }
  }
  return out;
}
