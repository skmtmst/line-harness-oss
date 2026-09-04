import { getSupportMarkById, jstNow, type SupportMarkScope } from '@line-crm/db';
import { buildSegmentWhere, type SegmentCondition } from './segment-query.js';

export const SUPPORT_MARK_RULE_EVENTS = [
  'message_received',
  'manual_reply_sent',
  'staff_assigned',
  'response_overdue',
  'condition_matched',
] as const;
export type SupportMarkRuleEvent = (typeof SUPPORT_MARK_RULE_EVENTS)[number];

export interface SupportMarkAutomationRule {
  id: string;
  name: string;
  markId: string;
  event: SupportMarkRuleEvent;
  condition: SegmentCondition | null;
  priority: number;
  manualProtectionMinutes: number;
  isActive: boolean;
  version: number;
  updatedAt: string;
}

export interface SaveSupportMarkAutomationRule {
  name: string;
  event: SupportMarkRuleEvent;
  condition?: SegmentCondition | null;
  priority: number;
  manualProtectionMinutes: number;
  isActive: boolean;
}

interface RuleRow {
  id: string;
  name: string;
  status: string;
  priority: number;
  updated_at: string;
  version_number: number;
  trigger_config: string;
  condition_config: string;
  action_config: string;
}

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function parseRule(row: RuleRow): SupportMarkAutomationRule | null {
  const trigger = parseObject(row.trigger_config);
  let actions: unknown;
  try {
    actions = JSON.parse(row.action_config);
  } catch {
    return null;
  }
  const action = Array.isArray(actions)
    ? actions.find((item) => item && typeof item === 'object'
      && (item as { type?: unknown }).type === 'set_support_mark') as Record<string, unknown> | undefined
    : undefined;
  const params = action && parseObject(JSON.stringify(action.params ?? null));
  const event = trigger?.event;
  const markId = params?.markId;
  if (!SUPPORT_MARK_RULE_EVENTS.includes(event as SupportMarkRuleEvent) || typeof markId !== 'string') {
    return null;
  }
  const conditionRaw = parseObject(row.condition_config);
  const condition = conditionRaw && Object.keys(conditionRaw).length > 0
    ? conditionRaw as unknown as SegmentCondition
    : null;
  return {
    id: row.id,
    name: row.name,
    markId,
    event: event as SupportMarkRuleEvent,
    condition,
    priority: row.priority,
    manualProtectionMinutes: Number(params?.manualProtectionMinutes ?? 0),
    isActive: row.status === 'active',
    version: row.version_number,
    updatedAt: row.updated_at,
  };
}

function validateInput(input: SaveSupportMarkAutomationRule): void {
  if (!input.name.trim()) throw new Error('rule_name_required');
  if (!SUPPORT_MARK_RULE_EVENTS.includes(input.event)) throw new Error('rule_event_invalid');
  if (!Number.isInteger(input.priority) || input.priority < -1000 || input.priority > 1000) {
    throw new Error('rule_priority_invalid');
  }
  if (!Number.isInteger(input.manualProtectionMinutes)
    || input.manualProtectionMinutes < 0
    || input.manualProtectionMinutes > 10080) {
    throw new Error('manual_protection_invalid');
  }
  if (input.condition) {
    try {
      buildSegmentWhere(input.condition);
    } catch {
      throw new Error('rule_condition_invalid');
    }
  }
}

function versionPayload(markId: string, input: SaveSupportMarkAutomationRule) {
  return {
    triggerConfig: JSON.stringify({ kind: 'support_mark_rule', event: input.event }),
    conditionConfig: JSON.stringify(input.condition ?? {}),
    actionConfig: JSON.stringify([{
      id: 'set-support-mark',
      type: 'set_support_mark',
      params: { markId, manualProtectionMinutes: input.manualProtectionMinutes },
      onFailure: 'stop',
    }]),
  };
}

async function rowsForAccount(db: D1Database, lineAccountId: string): Promise<RuleRow[]> {
  const rows = await db.prepare(
    `SELECT d.id, d.name, d.status, d.priority, d.updated_at,
            v.version_number, v.trigger_config, v.condition_config, v.action_config
       FROM automation_definitions d
       JOIN automation_versions v ON v.id = d.current_published_version_id
      WHERE d.line_account_id = ? AND d.status != 'archived'
        AND v.status = 'published' AND v.trigger_type = 'support_mark_change'
      ORDER BY d.priority DESC, d.created_at ASC`,
  ).bind(lineAccountId).all<RuleRow>();
  return rows.results ?? [];
}

export async function listSupportMarkAutomationRules(
  db: D1Database,
  scope: SupportMarkScope,
  markId: string,
): Promise<SupportMarkAutomationRule[] | null> {
  if (!await getSupportMarkById(db, markId, scope)) return null;
  return (await rowsForAccount(db, scope.lineAccountId))
    .map(parseRule)
    .filter((item): item is SupportMarkAutomationRule => !!item && item.markId === markId);
}

export async function createSupportMarkAutomationRule(
  db: D1Database,
  scope: SupportMarkScope,
  markId: string,
  actorId: string,
  input: SaveSupportMarkAutomationRule,
): Promise<SupportMarkAutomationRule | null> {
  validateInput(input);
  if (!await getSupportMarkById(db, markId, scope)) return null;
  const id = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const now = jstNow();
  const payload = versionPayload(markId, input);
  await db.batch([
    db.prepare(
      `INSERT INTO automation_definitions
         (id, line_account_id, name, description, status, priority, created_by, created_at, updated_at)
       VALUES (?, ?, ?, '対応マークの自動変更', ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      scope.lineAccountId,
      input.name.trim(),
      input.isActive ? 'active' : 'stopped',
      input.priority,
      actorId,
      now,
      now,
    ),
    db.prepare(
      `INSERT INTO automation_versions
         (id, automation_id, version_number, status, trigger_type, trigger_config,
          condition_config, action_config, created_by, created_at, published_at)
       VALUES (?, ?, 1, 'published', 'support_mark_change', ?, ?, ?, ?, ?, ?)`,
    ).bind(
      versionId,
      id,
      payload.triggerConfig,
      payload.conditionConfig,
      payload.actionConfig,
      actorId,
      now,
      now,
    ),
    db.prepare('UPDATE automation_definitions SET current_published_version_id = ? WHERE id = ?')
      .bind(versionId, id),
  ]);
  return (await rowsForAccount(db, scope.lineAccountId)).map(parseRule)
    .find((item) => item?.id === id) ?? null;
}

async function currentRule(
  db: D1Database,
  scope: SupportMarkScope,
  ruleId: string,
): Promise<SupportMarkAutomationRule | null> {
  return (await rowsForAccount(db, scope.lineAccountId)).map(parseRule)
    .find((item) => item?.id === ruleId) ?? null;
}

export async function updateSupportMarkAutomationRule(
  db: D1Database,
  scope: SupportMarkScope,
  ruleId: string,
  actorId: string,
  expectedVersion: number,
  input: SaveSupportMarkAutomationRule,
): Promise<'not_found' | 'conflict' | SupportMarkAutomationRule> {
  validateInput(input);
  const current = await currentRule(db, scope, ruleId);
  if (!current) return 'not_found';
  if (current.version !== expectedVersion) return 'conflict';
  const nextVersion = current.version + 1;
  const versionId = crypto.randomUUID();
  const now = jstNow();
  const payload = versionPayload(current.markId, input);
  const results = await db.batch([
    db.prepare(
      `INSERT INTO automation_versions
         (id, automation_id, version_number, status, trigger_type, trigger_config,
          condition_config, action_config, created_by, created_at, published_at)
       SELECT ?, id, ?, 'published', 'support_mark_change', ?, ?, ?, ?, ?, ?
         FROM automation_definitions
        WHERE id = ? AND line_account_id = ? AND current_published_version_id =
          (SELECT id FROM automation_versions WHERE automation_id = ? AND version_number = ?)`,
    ).bind(
      versionId,
      nextVersion,
      payload.triggerConfig,
      payload.conditionConfig,
      payload.actionConfig,
      actorId,
      now,
      now,
      ruleId,
      scope.lineAccountId,
      ruleId,
      expectedVersion,
    ),
    db.prepare(
      `UPDATE automation_definitions
          SET name = ?, status = ?, priority = ?, current_published_version_id = ?, updated_at = ?
        WHERE id = ? AND line_account_id = ?
          AND EXISTS (SELECT 1 FROM automation_versions WHERE id = ? AND automation_id = ?)`,
    ).bind(
      input.name.trim(),
      input.isActive ? 'active' : 'stopped',
      input.priority,
      versionId,
      now,
      ruleId,
      scope.lineAccountId,
      versionId,
      ruleId,
    ),
  ]);
  if ((results[0]?.meta?.changes ?? 0) !== 1 || (results[1]?.meta?.changes ?? 0) !== 1) {
    return 'conflict';
  }
  return await currentRule(db, scope, ruleId) ?? 'not_found';
}

export async function archiveSupportMarkAutomationRule(
  db: D1Database,
  scope: SupportMarkScope,
  ruleId: string,
  expectedVersion: number,
): Promise<'not_found' | 'conflict' | 'archived'> {
  const current = await currentRule(db, scope, ruleId);
  if (!current) return 'not_found';
  if (current.version !== expectedVersion) return 'conflict';
  const now = jstNow();
  const result = await db.prepare(
    `UPDATE automation_definitions SET status = 'archived', archived_at = ?, updated_at = ?
      WHERE id = ? AND line_account_id = ? AND current_published_version_id =
        (SELECT id FROM automation_versions WHERE automation_id = ? AND version_number = ?)`,
  ).bind(now, now, ruleId, scope.lineAccountId, ruleId, expectedVersion).run();
  return (result.meta?.changes ?? 0) === 1 ? 'archived' : 'conflict';
}
