import type { SegmentCondition } from '@line-crm/shared';
import { AutomationActionError } from './automation-action-error.js';

/*
 * 監査 : 共通アクション参照の展開上限。公開前の検査
 * （common-actions.ts の assertPublishableExpansion）と実行時の計画
 * （buildExecutionPlan）で同じ値を使う。片方だけ変えない。
 */
export const COMMON_ACTION_MAX_DEPTH = 20;
export const COMMON_ACTION_MAX_BRANCH_DEPTH = 3;
export const COMMON_ACTION_MAX_STEPS = 1000;
type FailureMode = 'stop' | 'continue';

export interface ActionDefinition {
  id: string;
  type: string;
  params: Record<string, unknown>;
  onFailure: FailureMode;
  /** 実行開始時に固定した共通アクション版。実行計画だけが持つ。 */
  commonActionVersionId?: string | null;
  /** 実行計画で固定した、親分岐の通過条件。保存APIから直接は受け取らない。 */
  branchConditions?: Array<{ condition: SegmentCondition; expected: boolean; branchStepKey?: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseActions(text: string): ActionDefinition[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new AutomationActionError('invalid_action_config_json', '処理定義のJSONが不正です', false);
  }
  if (!Array.isArray(value)) {
    throw new AutomationActionError('invalid_action_config', '処理定義は配列である必要があります', false);
  }

  const ids = new Set<string>();
  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new AutomationActionError('invalid_action_shape', `${index + 1}番目の処理定義が不正です`, false);
    }
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const type = typeof item.type === 'string' ? item.type.trim() : '';
    const params = item.params;
    const onFailure = item.onFailure ?? 'stop';
    if (!id || !type || !isRecord(params) || (onFailure !== 'stop' && onFailure !== 'continue')) {
      throw new AutomationActionError('invalid_action_shape', `${index + 1}番目の処理定義が不正です`, false);
    }
    if (ids.has(id)) {
      throw new AutomationActionError('duplicate_action_id', `処理ID ${id} が重複しています`, false);
    }
    ids.add(id);
    const commonActionVersionId = typeof item.commonActionVersionId === 'string'
      ? item.commonActionVersionId.trim() || null
      : null;
    let branchConditions: ActionDefinition['branchConditions'];
    if (item.branchConditions !== undefined) {
      if (!Array.isArray(item.branchConditions)) {
        throw new AutomationActionError('invalid_branch_condition', '分岐の実行条件が不正です', false);
      }
      branchConditions = item.branchConditions.map((entry) => {
        if (!isRecord(entry) || !isRecord(entry.condition) || typeof entry.expected !== 'boolean') {
          throw new AutomationActionError('invalid_branch_condition', '分岐の実行条件が不正です', false);
        }
        if (entry.branchStepKey !== undefined && (typeof entry.branchStepKey !== 'string' || !entry.branchStepKey)) {
          throw new AutomationActionError('invalid_branch_condition', '分岐の記録先が不正です', false);
        }
        return { condition: entry.condition as unknown as SegmentCondition, expected: entry.expected,
          branchStepKey: entry.branchStepKey as string | undefined };
      });
    }
    return { id, type, params, onFailure, commonActionVersionId, branchConditions };
  });
}

export async function resolveCommonActionVersion(
  db: D1Database,
  input: { lineAccountId: string; automationId: string; action: ActionDefinition },
): Promise<string | null> {
  if (input.action.type !== 'common_action') return null;
  const commonActionId = input.action.params.commonActionId;
  if (typeof commonActionId !== 'string' || !commonActionId.trim()) return null;

  const explicitVersionId = input.action.params.commonActionVersionId;
  if (typeof explicitVersionId === 'string' && explicitVersionId.trim()) {
    const explicit = await db.prepare(
      `SELECT cav.id
         FROM common_action_versions cav
         JOIN common_actions ca ON ca.id = cav.common_action_id
        WHERE cav.id = ? AND cav.common_action_id = ? AND cav.status = 'published'
          AND ca.line_account_id = ?`,
    ).bind(explicitVersionId, commonActionId, input.lineAccountId).first<{ id: string }>();
    return explicit?.id ?? null;
  }

  const binding = await db.prepare(
    `SELECT b.common_action_version_id AS id
       FROM common_action_bindings b
       JOIN common_action_versions cav
         ON cav.id = b.common_action_version_id AND cav.common_action_id = b.common_action_id
      WHERE b.line_account_id = ? AND b.consumer_type = 'automation'
        AND b.consumer_id = ? AND b.consumer_path = ? AND b.common_action_id = ?
        AND cav.status = 'published'
      LIMIT 1`,
  ).bind(input.lineAccountId, input.automationId, input.action.id, commonActionId)
    .first<{ id: string }>();
  return binding?.id ?? null;
}

export async function buildExecutionPlan(
  db: D1Database,
  input: {
    lineAccountId: string;
    automationId: string;
    actions: ActionDefinition[];
    prefix?: string;
    depth?: number;
    budget?: { count: number };
    branchDepth?: number;
    branchConditions?: ActionDefinition['branchConditions'];
  },
): Promise<ActionDefinition[]> {
  const depth = input.depth ?? 0;
  const branchDepth = input.branchDepth ?? 0;
  const budget = input.budget ?? { count: 0 };
  if (depth > COMMON_ACTION_MAX_DEPTH) {
    throw new AutomationActionError('common_action_too_deep', '共通アクションの呼び出しが深すぎます', false);
  }
  const plan: ActionDefinition[] = [];
  for (const action of input.actions) {
    budget.count += 1;
    if (budget.count > COMMON_ACTION_MAX_STEPS) {
      throw new AutomationActionError('execution_plan_too_large', '実行する処理が多すぎます', false);
    }
    const stepKey = input.prefix ? `${input.prefix}/${action.id}` : action.id;
    if (action.type === 'branch') {
      if (branchDepth >= COMMON_ACTION_MAX_BRANCH_DEPTH) {
        throw new AutomationActionError('branch_too_deep', '条件分岐の入れ子は3段までです', false);
      }
      const condition = action.params.condition as SegmentCondition;
      const thenActions = action.params.then as ActionDefinition[];
      const elseActions = action.params.else as ActionDefinition[];
      if (!condition || !Array.isArray(thenActions) || !Array.isArray(elseActions)) {
        throw new AutomationActionError('branch_invalid', '条件分岐の設定が壊れています', false);
      }
      plan.push({
        ...action,
        id: stepKey,
        type: 'branch_marker',
        params: { condition },
        branchConditions: input.branchConditions,
      });
      plan.push(...await buildExecutionPlan(db, {
        ...input,
        actions: thenActions,
        prefix: `${stepKey}/then`,
        branchDepth: branchDepth + 1,
        branchConditions: [...(input.branchConditions ?? []), { condition, expected: true, branchStepKey: stepKey }],
        budget,
      }));
      plan.push(...await buildExecutionPlan(db, {
        ...input,
        actions: elseActions,
        prefix: `${stepKey}/else`,
        branchDepth: branchDepth + 1,
        branchConditions: [...(input.branchConditions ?? []), { condition, expected: false, branchStepKey: stepKey }],
        budget,
      }));
      continue;
    }
    if (action.type !== 'common_action') {
      const params = action.type === 'wait' && action.params.durationMinutes === undefined
        ? { ...action.params, durationMinutes: action.params.minutes }
        : action.params;
      plan.push({ ...action, id: stepKey, params, branchConditions: input.branchConditions });
      continue;
    }

    const commonActionVersionId = await resolveCommonActionVersion(db, {
      lineAccountId: input.lineAccountId,
      automationId: input.automationId,
      action,
    });
    if (!commonActionVersionId) {
      throw new AutomationActionError(
        'common_action_version_not_pinned',
        '公開済みの共通アクション版を固定できませんでした',
        false,
      );
    }
    const version = await db.prepare(
      `SELECT cav.action_config
         FROM common_action_versions cav
         JOIN common_actions ca ON ca.id = cav.common_action_id
        WHERE cav.id = ? AND cav.status = 'published' AND ca.line_account_id = ?`,
    ).bind(commonActionVersionId, input.lineAccountId).first<{ action_config: string }>();
    if (!version) {
      throw new AutomationActionError('common_action_version_not_found', '固定した共通アクション版が見つかりません', false);
    }

    // 利用版を実行履歴に1行残し、その後ろへ実際の処理を展開する。
    plan.push({
      id: stepKey,
      type: 'common_action_marker',
      params: { commonActionId: action.params.commonActionId },
      onFailure: action.onFailure,
      commonActionVersionId,
      branchConditions: input.branchConditions,
    });
    plan.push(...await buildExecutionPlan(db, {
      lineAccountId: input.lineAccountId,
      automationId: input.automationId,
      actions: parseActions(version.action_config),
      prefix: stepKey,
      depth: depth + 1,
      branchDepth,
      branchConditions: input.branchConditions,
      budget,
    }));
  }
  return plan;
}
