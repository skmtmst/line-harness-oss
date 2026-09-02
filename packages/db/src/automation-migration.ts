/**
 * 旧 automations のV6移行判定。
 *
 * ここでは変換可能性だけを判定し、DBへは一切書かない。通常APIや新実行
 * エンジンから旧JSONを読む用途には使わず、移行dry-run専用にする。
 */

export type AutomationMigrationDecision = 'auto_convert' | 'needs_review' | 'excluded';

export interface LegacyAutomationMigrationRow {
  id: string;
  name: string;
  line_account_id: string | null;
  event_type: string;
  conditions: string;
  actions: string;
  is_active: number;
  priority: number;
}

export interface AutomationMigrationAssessment {
  id: string;
  name: string;
  lineAccountId: string | null;
  decision: AutomationMigrationDecision;
  reasons: string[];
  wouldRemainActive: boolean;
}

export interface AutomationMigrationReport {
  total: number;
  autoConvert: number;
  needsReview: number;
  excluded: number;
  assessments: AutomationMigrationAssessment[];
}

const KNOWN_EVENT_TYPES = new Set([
  'friend_add',
  'tag_change',
  'score_threshold',
  'cv_fire',
  'message_received',
  'postback_received',
  'calendar_booked',
  'ec.order.confirmed',
  'ec.order.shipped',
  'ec.subscription.upcoming',
  'ec.subscription.payment_failed',
  'ec.subscription.cancelled',
]);

const KNOWN_ACTION_TYPES = new Set([
  'add_tag',
  'remove_tag',
  'start_scenario',
  'send_message',
  'switch_rich_menu',
  'remove_rich_menu',
  'set_metadata',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function actionProblem(action: unknown, index: number): string | null {
  if (!isRecord(action) || !nonEmptyString(action.type) || !isRecord(action.params)) {
    return `action_${index + 1}_invalid_shape`;
  }

  const type = action.type as string;
  const params = action.params;
  if (type === 'send_webhook') {
    return `action_${index + 1}_webhook_requires_secret_and_ssrf_review`;
  }
  if (!KNOWN_ACTION_TYPES.has(type)) return `action_${index + 1}_unknown_type:${type}`;

  if ((type === 'add_tag' || type === 'remove_tag') && !nonEmptyString(params.tagId)) {
    return `action_${index + 1}_missing_tag_id`;
  }
  if (type === 'start_scenario' && !nonEmptyString(params.scenarioId)) {
    return `action_${index + 1}_missing_scenario_id`;
  }
  if (type === 'switch_rich_menu' && !nonEmptyString(params.richMenuId)) {
    return `action_${index + 1}_missing_rich_menu_id`;
  }
  if (
    type === 'send_message'
    && !nonEmptyString(params.template_id)
    && !nonEmptyString(params.content)
  ) {
    return `action_${index + 1}_missing_message_content`;
  }
  if (type === 'set_metadata' && !nonEmptyString(params.data)) {
    return `action_${index + 1}_missing_metadata`;
  }
  return null;
}

export function assessLegacyAutomation(
  row: LegacyAutomationMigrationRow,
): AutomationMigrationAssessment {
  const excludedReasons: string[] = [];
  const reviewReasons: string[] = [];

  if (!row.line_account_id?.trim()) excludedReasons.push('line_account_id_missing');

  const conditions = parseJson(row.conditions);
  if (!conditions.ok) excludedReasons.push('conditions_json_invalid');
  else if (!isRecord(conditions.value)) excludedReasons.push('conditions_must_be_object');

  const actions = parseJson(row.actions);
  if (!actions.ok) excludedReasons.push('actions_json_invalid');
  else if (!Array.isArray(actions.value)) excludedReasons.push('actions_must_be_array');
  else if (actions.value.length === 0) reviewReasons.push('actions_empty');
  else {
    for (const [index, action] of actions.value.entries()) {
      const problem = actionProblem(action, index);
      if (problem) reviewReasons.push(problem);
    }
  }

  if (!KNOWN_EVENT_TYPES.has(row.event_type)) {
    reviewReasons.push(`event_type_unknown:${row.event_type}`);
  }

  const decision: AutomationMigrationDecision = excludedReasons.length > 0
    ? 'excluded'
    : reviewReasons.length > 0
      ? 'needs_review'
      : 'auto_convert';
  const reasons = decision === 'excluded' ? excludedReasons : reviewReasons;

  return {
    id: row.id,
    name: row.name,
    lineAccountId: row.line_account_id,
    decision,
    reasons,
    wouldRemainActive: decision === 'auto_convert' && row.is_active === 1,
  };
}

export function analyzeLegacyAutomations(
  rows: LegacyAutomationMigrationRow[],
): AutomationMigrationReport {
  const assessments = rows.map(assessLegacyAutomation);
  return {
    total: assessments.length,
    autoConvert: assessments.filter((item) => item.decision === 'auto_convert').length,
    needsReview: assessments.filter((item) => item.decision === 'needs_review').length,
    excluded: assessments.filter((item) => item.decision === 'excluded').length,
    assessments,
  };
}
