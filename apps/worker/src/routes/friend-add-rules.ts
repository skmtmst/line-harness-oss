import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  archiveFriendAddRule,
  createFriendAddRuleDraft,
  ensureFriendAddFallbackRules,
  getFriendAddRule,
  listFriendAddRules,
  listFriendAddRulesPage,
  publishFriendAddRule,
  recordFriendAddRuleTest,
  saveFriendAddRuleDraft,
  stopFriendAddRule,
  type FriendAddRuleDefinition,
  type FriendAddRuleKind,
  type FriendAddRuleRow,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';
import {
  areFriendAddConditionsOverlapping,
  doFriendAddTimeWindowsOverlap,
  doFriendAddWeekdaySetsOverlap,
  isValidFriendAddHhmm,
} from '../services/friend-add-routing.js';

const friendAddRules = new Hono<Env>();
const KINDS = new Set<FriendAddRuleKind>(['first_time', 'returning']);
const RULE_STATUSES = new Set(['draft', 'published', 'stopped', 'archived']);
const MESSAGE_TYPES = new Set(['text', 'template', 'form', 'scenario']);
const TIMINGS = new Set(['immediate', 'scenario']);
const ACTION_TYPES = new Set([
  'add_tag',
  'remove_tag',
  'start_scenario',
]);

type RuleInput = {
  accountId?: string;
  friendKind?: FriendAddRuleKind;
  name?: string;
  folderName?: string | null;
  priority?: number;
  definition?: Partial<FriendAddRuleDefinition>;
  version?: number;
};

type RuleTestInput = {
  accountId?: string;
  ruleId?: string;
  friendKind?: FriendAddRuleKind;
  routeId?: string | null;
  expectedAt?: string | null;
};

function accountIdFrom(c: Context<Env>, body?: RuleInput): string | null {
  return c.req.query('account_id') || body?.accountId || null;
}

async function canUseAccount(c: Context<Env>, accountId: string): Promise<boolean> {
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  return scope.ids.includes(accountId);
}

function parseSnapshot(value: string | null): FriendAddRuleDefinition {
  const raw = value ? JSON.parse(value) as Partial<FriendAddRuleDefinition> : {};
  return normalizeDefinition(raw);
}

function normalizeDefinition(raw: Partial<FriendAddRuleDefinition> | undefined): FriendAddRuleDefinition {
  const definition = raw ?? {};
  const messageType = MESSAGE_TYPES.has(String(definition.messageType))
    ? definition.messageType as FriendAddRuleDefinition['messageType']
    : 'text';
  const timing = TIMINGS.has(String(definition.timing))
    ? definition.timing as FriendAddRuleDefinition['timing']
    : 'immediate';
  const actions = Array.isArray(definition.actions)
    ? definition.actions.filter((action) => {
      if (!action || typeof action !== 'object') return false;
      const type = (action as { type?: unknown }).type;
      return typeof type === 'string' && ACTION_TYPES.has(type);
    })
    : [];
  const deliveryChoices = definition.deliveryChoices && typeof definition.deliveryChoices === 'object'
    ? {
        sendWelcomeMessage: definition.deliveryChoices.sendWelcomeMessage === true,
        startScenario: definition.deliveryChoices.startScenario !== false,
        runActions: definition.deliveryChoices.runActions !== false,
      }
    : {
        sendWelcomeMessage: messageType !== 'scenario',
        startScenario: true,
        runActions: true,
      };
  const resendSuppressionHours = definition.resendSuppressionHours == null
    ? 24
    : Math.max(0, Math.min(720, Math.floor(Number(definition.resendSuppressionHours))));
  const unknownRouteAction = definition.unknownRouteAction && typeof definition.unknownRouteAction === 'object'
    ? {
        sendCommonGuidance: definition.unknownRouteAction.sendCommonGuidance === true,
        notifyStaff: definition.unknownRouteAction.notifyStaff === true,
      }
    : { sendCommonGuidance: true, notifyStaff: false };
  const weekdays = Array.isArray(definition.weekdays)
    ? [...new Set(definition.weekdays.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6))]
    : [];
  /*
   * 時間帯は「文字の組」まで残し、範囲の正しさは残さない（落とさない）。
   * 99:99 のような不正値をここで落とすと「制限なし」に読み替わり、
   * 送ってはいけない相手に送ってしまう。保存側の validateInput が
   * 新規の不正値を拒否し、既に入った不正値は実行時が fail-closed で止める。
   */
  const timeWindows = Array.isArray(definition.timeWindows)
    ? definition.timeWindows.filter((window): window is { start: string; end: string } => (
        Boolean(window) && typeof (window as { start?: unknown }).start === 'string'
        && typeof (window as { end?: unknown }).end === 'string'
      ))
    : [];
  return {
    routeIds: Array.isArray(definition.routeIds)
      ? definition.routeIds.filter((id): id is string => typeof id === 'string' && Boolean(id))
      : [],
    scenarioId: typeof definition.scenarioId === 'string' && definition.scenarioId
      ? definition.scenarioId
      : null,
    messageType,
    messageText: typeof definition.messageText === 'string' ? definition.messageText.slice(0, 5000) : '',
    timing,
    actions,
    friendCondition: typeof definition.friendCondition === 'string'
      ? definition.friendCondition.slice(0, 1000)
      : '',
    internalMemo: typeof definition.internalMemo === 'string'
      ? definition.internalMemo.slice(0, 2000)
      : undefined,
    activeFrom: typeof definition.activeFrom === 'string' && definition.activeFrom ? definition.activeFrom : null,
    activeUntil: typeof definition.activeUntil === 'string' && definition.activeUntil ? definition.activeUntil : null,
    returningMode: definition.returningMode === 'none' || definition.returningMode === 'same' || definition.returningMode === 'other'
      ? definition.returningMode
      : undefined,
    startPosition: definition.startPosition === 'beginning' || definition.startPosition === 'resume'
      ? definition.startPosition
      : undefined,
    deliveryChoices,
    resendSuppressionHours,
    unknownRouteAction,
    weekdays,
    timeWindows,
  };
}

async function loadOptions(db: D1Database, accountId: string) {
  const [routeRows, scenarioRows, tagRows, folderRows] = await Promise.all([
    db.prepare(
      `SELECT id, name, COALESCE(genre, '未分類') AS kind
         FROM entry_routes
        WHERE is_active = 1 AND (
          line_account_id = ? OR (
            line_account_id IS NULL
            AND tenant_id = (SELECT tenant_id FROM line_accounts WHERE id = ?)
          )
        )
        ORDER BY name ASC`,
    ).bind(accountId, accountId).all<{ id: string; name: string; kind: string }>(),
    db.prepare(
      `SELECT id, name FROM scenarios
        WHERE line_account_id = ? AND is_active = 1
        ORDER BY name ASC`,
    ).bind(accountId).all<{ id: string; name: string }>(),
    db.prepare(
      `SELECT id, name FROM tags
        WHERE line_account_id = ?
        ORDER BY name ASC`,
    ).bind(accountId).all<{ id: string; name: string }>(),
    db.prepare(
      `SELECT id, name FROM friend_add_rule_folders
        WHERE line_account_id = ? ORDER BY name ASC, id ASC`,
    ).bind(accountId).all<{ id: string; name: string }>(),
  ]);
  return {
    routes: routeRows.results ?? [],
    scenarios: scenarioRows.results ?? [],
    tags: tagRows.results ?? [],
    folders: folderRows.results ?? [],
  };
}

function toRule(row: FriendAddRuleRow, routeNames: Map<string, string>, scenarioNames: Map<string, string>) {
  const definition = parseSnapshot(row.definition_snapshot);
  return {
    id: row.id,
    accountId: row.line_account_id,
    friendKind: row.friend_kind,
    name: row.name,
    folderName: row.folder_name,
    priority: row.priority,
    isFallback: row.is_unknown_route_fallback === 1,
    status: row.status,
    versionId: row.version_id,
    versionNumber: row.version_number,
    versionStatus: row.version_status,
    lastTestStatus: row.last_test_status,
    lastTestedAt: row.last_tested_at,
    lastTestedByStaffId: row.last_tested_by_staff_id,
    lastTestedByStaffName: row.last_tested_by_staff_name,
    publishedAt: row.published_at,
    matchedLast7Days: row.matched_last_7_days,
    version: row.lock_version,
    definition,
    routeNames: definition.routeIds.map((id) => routeNames.get(id) ?? '削除済みの流入リンク'),
    scenarioName: definition.scenarioId ? scenarioNames.get(definition.scenarioId) ?? '削除済みのシナリオ' : null,
  };
}

function validateInput(body: RuleInput): string | null {
  if (!body.name?.trim()) return '設定名が必要です';
  if (body.name.trim().length > 60) return '設定名は60文字以内で入力してください';
  if (!body.friendKind || !KINDS.has(body.friendKind)) return '判定する人が正しくありません';
  if (!Number.isInteger(body.priority) || Number(body.priority) < 1) return '優先順位は1以上の整数で入力してください';
  // 不正な時間帯（99:99 など）は保存させない。落として保存すると
  // 「制限なし」に読み替わり、送ってはいけない相手に送ってしまう。
  const timeWindows = body.definition?.timeWindows;
  if (timeWindows != null) {
    if (!Array.isArray(timeWindows)) return '時間帯の指定が正しくありません';
    for (const window of timeWindows) {
      const start = (window as { start?: unknown } | null)?.start;
      const end = (window as { end?: unknown } | null)?.end;
      if (!isValidFriendAddHhmm(start) || !isValidFriendAddHhmm(end)) {
        return '時間帯は00:00〜23:59の形で入力してください';
      }
    }
  }
  return null;
}

type ReferenceErrorKey = 'first_time' | 'returning' | 'actions';

export type FriendAddRuleReferenceError = {
  key: ReferenceErrorKey;
  message: string;
};

async function validateReferences(
  db: D1Database,
  accountId: string,
  definition: FriendAddRuleDefinition,
  friendKind: FriendAddRuleKind,
): Promise<FriendAddRuleReferenceError[]> {
  const messages: FriendAddRuleReferenceError[] = [];
  const push = (key: ReferenceErrorKey, message: string) => {
    messages.push({ key, message });
  };
  if (definition.routeIds.length > 0) {
    const placeholders = definition.routeIds.map(() => '?').join(',');
    const rows = await db.prepare(
      `SELECT id FROM entry_routes
        WHERE is_active = 1 AND id IN (${placeholders}) AND (
          line_account_id = ? OR (
            line_account_id IS NULL
            AND tenant_id = (SELECT tenant_id FROM line_accounts WHERE id = ?)
          )
        )`,
    ).bind(...definition.routeIds, accountId, accountId).all<{ id: string }>();
    if ((rows.results ?? []).length !== new Set(definition.routeIds).size) {
      push(friendKind, 'このLINEアカウントで使えない流入リンクが含まれています。');
    }
  }
  if (definition.scenarioId) {
    const scenario = await db.prepare(
      `SELECT id FROM scenarios
        WHERE id = ? AND line_account_id = ? AND is_active = 1`,
    ).bind(definition.scenarioId, accountId).first<{ id: string }>();
    if (!scenario) push(friendKind, 'このLINEアカウントで使えないシナリオです。');
  }
  const tagIds = definition.actions
    .filter((action) => action.type === 'add_tag' || action.type === 'remove_tag')
    .map((action) => action.targetId)
    .filter((id): id is string => typeof id === 'string' && Boolean(id));
  if (tagIds.length > 0) {
    const unique = [...new Set(tagIds)];
    const placeholders = unique.map(() => '?').join(',');
    const rows = await db.prepare(
      `SELECT id FROM tags WHERE line_account_id = ? AND id IN (${placeholders})`,
    ).bind(accountId, ...unique).all<{ id: string }>();
    if ((rows.results ?? []).length !== unique.length) push('actions', 'このLINEアカウントで使えないタグが含まれています。');
  }
  const actionScenarioIds = definition.actions
    .filter((action) => action.type === 'start_scenario')
    .map((action) => action.targetId)
    .filter((id): id is string => typeof id === 'string' && Boolean(id));
  if (actionScenarioIds.length > 0) {
    const unique = [...new Set(actionScenarioIds)];
    const placeholders = unique.map(() => '?').join(',');
    const rows = await db.prepare(
      `SELECT id FROM scenarios
        WHERE line_account_id = ? AND is_active = 1 AND id IN (${placeholders})`,
    ).bind(accountId, ...unique).all<{ id: string }>();
    if ((rows.results ?? []).length !== unique.length) push('actions', 'アクションに使えないシナリオが含まれています。');
  }
  if (definition.activeFrom && definition.activeUntil && definition.activeFrom > definition.activeUntil) {
    push(friendKind, '有効期間の終了は開始より後にしてください。');
  }
  /*
   * 再追加で「何も配信しない」(returningMode none) ときはシナリオを使わない。
   * 要件 v6-09 §4-3 の正規の選択肢であり、受け皿ルール自身も scenarioId なしで
   * 作られる (ensureFriendAddFallbackRules)。それ以外は従来どおり必須。
   */
  const skipsScenario = friendKind === 'returning' && definition.returningMode === 'none';
  if (!definition.scenarioId && !skipsScenario) {
    push(friendKind, '実際に配信するシナリオを決めてください。');
  }
  return messages;
}

async function ruleTestResponse(c: Context<Env>, accountId: string, ruleId: string) {
  const staff = c.get('staff');
  if (staff.role === 'staff' && !staff.permissionKeys?.includes('/friend-add-settings')) {
    return c.json({ success: false, error: 'この機能を操作する権限がありません' }, 403);
  }
  const row = await getFriendAddRule(c.env.DB, { lineAccountId: accountId, ruleId });
  if (!row) return c.json({ success: false, error: '設定が見つかりません' }, 404);
  const definition = parseSnapshot(row.definition_snapshot);
  const errors = await validateReferences(c.env.DB, accountId, definition, row.friend_kind);
  if (row.version_status === 'draft') {
    await recordFriendAddRuleTest(c.env.DB, {
      lineAccountId: accountId,
      ruleId: row.id,
      staffId: staff.id,
      succeeded: errors.length === 0,
    });
  }
  /*
   * 失敗も成功時と同じ器 (HTTP 200) で返す。400 にすると管理画面の共通取得部が
   * 本文を捨てるため、何を直せばよいか (reasons) が運用者に届かない。
   * 結果の成否は `matched` と `reasons` で見る。
   */
  return c.json({
    success: errors.length === 0,
    data: {
      stateChanged: false,
      ruleId: row.id,
      matched: errors.length === 0,
      reasons: errors.length === 0 ? ['この設定が優先順位どおりに選ばれます。'] : errors.map((error) => error.message),
      scenarioId: definition.scenarioId,
      message: definition.messageText || null,
      actions: definition.actions,
    },
    ...(errors.length > 0 ? { error: 'テスト条件を確認してください' } : {}),
  });
}

type RunCursor = { occurredAt: string; id: string };

function parseRunCursor(value: string | undefined): RunCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Partial<RunCursor>;
    return typeof parsed.occurredAt === 'string' && typeof parsed.id === 'string'
      ? { occurredAt: parsed.occurredAt, id: parsed.id }
      : null;
  } catch {
    return null;
  }
}

function makeRunCursor(row: { occurred_at: string; id: string }): string {
  return encodeURIComponent(JSON.stringify({ occurredAt: row.occurred_at, id: row.id }));
}

const RUN_STATUSES = new Set(['pending', 'completed', 'failed', 'suppressed']);

const RUN_ATTRIBUTIONS = new Set(['captured', 'unavailable']);

friendAddRules.get('/api/friend-add-runs', requireRole('owner', 'admin', 'staff'), async (c) => {
  const accountId = accountIdFrom(c);
  const status = c.req.query('status');
  const ruleId = c.req.query('rule_id');
  const kind = c.req.query('kind');
  const attribution = c.req.query('attribution');
  const limit = Number(c.req.query('limit') ?? 20);
  const cursorValue = c.req.query('cursor');
  const cursor = parseRunCursor(cursorValue);
  if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
  if (status && !RUN_STATUSES.has(status)) return c.json({ success: false, error: 'status が正しくありません' }, 400);
  if (kind && !KINDS.has(kind as FriendAddRuleKind)) return c.json({ success: false, error: 'kind が正しくありません' }, 400);
  if (attribution && !RUN_ATTRIBUTIONS.has(attribution)) return c.json({ success: false, error: 'attribution が正しくありません' }, 400);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return c.json({ success: false, error: 'limit は1〜100で指定してください' }, 400);
  if (cursorValue && !cursor) return c.json({ success: false, error: 'cursor が正しくありません' }, 400);
  try {
    if (!await canUseAccount(c, accountId)) return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
    const clauses = ['e.line_account_id = ?'];
    const bindings: Array<string | number> = [accountId];
    if (status) { clauses.push('e.routing_status = ?'); bindings.push(status); }
    if (ruleId) { clauses.push('e.routing_rule_id = ?'); bindings.push(ruleId); }
    // 種類・経路の絞り込みはサーバ側で行う。取得済み20件への表示絞りでは
    // 2ページ目以降が漏れるため、ここで絞って件数も合わせる。
    if (kind) { clauses.push('e.friend_kind = ?'); bindings.push(kind); }
    if (attribution) { clauses.push('e.attribution_status = ?'); bindings.push(attribution); }
    const total = await c.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM friend_add_events e WHERE ${clauses.join(' AND ')}`,
    ).bind(...bindings).first<{ count: number }>();
    if (cursor) {
      clauses.push('(e.occurred_at < ? OR (e.occurred_at = ? AND e.id < ?))');
      bindings.push(cursor.occurredAt, cursor.occurredAt, cursor.id);
    }
    const [result, summary] = await Promise.all([
      c.env.DB.prepare(
        `SELECT e.id, e.friend_id, f.display_name, e.friend_kind, e.attribution_status,
                e.entry_route_id, er.name AS entry_route_name, e.ref_code,
                e.routing_status, e.error_code, e.occurred_at, e.processed_at,
                r.id AS rule_id, r.name AS rule_name,
                v.id AS version_id, v.version_number,
                json_extract(v.definition_snapshot, '$.scenarioId') AS scenario_id,
                s.name AS scenario_name,
                e.scenario_enrollment_id AS enrollment_id,
                e.delivery_count,
                COALESCE(ar.action_count, 0) AS action_count,
                COALESCE(ar.failed_action_count, 0) AS failed_action_count
           FROM friend_add_events e
           JOIN friends f ON f.id = e.friend_id AND f.line_account_id = e.line_account_id
           LEFT JOIN entry_routes er ON er.id = e.entry_route_id
           LEFT JOIN friend_add_rules r ON r.id = e.routing_rule_id AND r.line_account_id = e.line_account_id
           LEFT JOIN friend_add_rule_versions v ON v.id = e.winning_rule_version_id AND v.rule_id = r.id
           LEFT JOIN scenarios s ON s.id = json_extract(v.definition_snapshot, '$.scenarioId')
           LEFT JOIN (
             SELECT event_id, COUNT(*) AS action_count,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_action_count
               FROM friend_add_action_runs
              GROUP BY event_id
           ) ar ON ar.event_id = e.id
          WHERE ${clauses.join(' AND ')}
          ORDER BY e.occurred_at DESC, e.id DESC LIMIT ?`,
      ).bind(...bindings, limit + 1).all<{
        id: string; friend_id: string; display_name: string | null; friend_kind: string;
        attribution_status: string; entry_route_id: string | null; entry_route_name: string | null;
        ref_code: string | null; routing_status: string; error_code: string | null;
        occurred_at: string; processed_at: string | null; rule_id: string | null;
        rule_name: string | null; version_id: string | null; version_number: number | null;
        scenario_id: string | null; scenario_name: string | null; enrollment_id: string | null;
        delivery_count: number; action_count: number; failed_action_count: number;
      }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS total_runs,
                SUM(delivery_count) AS delivery_count,
                SUM(CASE WHEN routing_status = 'failed' THEN 1 ELSE 0 END) AS failed_runs,
                AVG(CASE WHEN first_delivery_sent_at IS NOT NULL
                    THEN (julianday(first_delivery_sent_at) - julianday(occurred_at)) * 86400000 END) AS average_send_ms,
                SUM(CASE WHEN scenario_enrollment_id IS NOT NULL THEN 1 ELSE 0 END) AS scenario_starts
           FROM friend_add_events
          WHERE line_account_id = ?`,
      ).bind(accountId).first<{
        total_runs: number; delivery_count: number | null; failed_runs: number | null;
        average_send_ms: number | null; scenario_starts: number | null;
      }>(),
    ]);
    const allRows = result.results ?? [];
    const items = allRows.slice(0, limit);
    return c.json({
      success: true,
      data: {
        items: items.map((row) => ({
          id: row.id,
          receivedAt: row.occurred_at,
          processedAt: row.processed_at,
          friend: { id: row.friend_id, displayName: row.display_name },
          friendKind: row.friend_kind,
          attribution: {
            status: row.attribution_status,
            routeId: row.entry_route_id,
            routeName: row.entry_route_name,
            reason: row.ref_code,
          },
          rule: row.rule_id ? {
            id: row.rule_id,
            name: row.rule_name,
            versionId: row.version_id,
            versionNumber: row.version_number,
          } : null,
          scenario: row.scenario_id ? {
            id: row.scenario_id,
            name: row.scenario_name,
            enrollmentId: row.enrollment_id,
            started: row.enrollment_id !== null,
          } : null,
          actions: { total: row.action_count, failed: row.failed_action_count },
          deliveryCount: row.delivery_count,
          status: row.routing_status,
          errorCode: row.error_code,
        })),
        total: total?.count ?? 0,
        nextCursor: allRows.length > limit && items.length > 0 ? makeRunCursor(items[items.length - 1]) : null,
        summary: {
          totalRuns: summary?.total_runs ?? 0,
          cumulativeDeliveries: summary?.delivery_count ?? 0,
          scenarioStarts: summary?.scenario_starts ?? 0,
          averageSendTimeMs: summary?.average_send_ms == null ? null : Math.max(0, Math.round(summary.average_send_ms)),
          failed: summary?.failed_runs ?? 0,
          staffHandoffs: { value: null, state: 'unavailable', reason: '担当者引き継ぎと実行イベントを結ぶ記録がありません' },
        },
      },
    });
  } catch (error) {
    console.error('GET /api/friend-add-runs error:', error);
    return c.json({ success: false, error: '実行結果を取得できませんでした' }, 500);
  }
});

friendAddRules.get('/api/friend-add-runs/:id', requireRole('owner', 'admin', 'staff'), async (c) => {
  const accountId = accountIdFrom(c);
  if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
  try {
    if (!await canUseAccount(c, accountId)) return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
    const row = await c.env.DB.prepare(
      `SELECT e.id, e.friend_id, f.display_name, e.friend_kind, e.attribution_status,
              e.entry_route_id, er.name AS entry_route_name, e.ref_code,
              e.routing_status, e.error_code, e.occurred_at, e.processed_at,
              r.id AS rule_id, r.name AS rule_name,
              v.id AS version_id, v.version_number, v.definition_snapshot
         FROM friend_add_events e
         JOIN friends f ON f.id = e.friend_id AND f.line_account_id = e.line_account_id
         LEFT JOIN entry_routes er ON er.id = e.entry_route_id
         LEFT JOIN friend_add_rules r ON r.id = e.routing_rule_id AND r.line_account_id = e.line_account_id
         LEFT JOIN friend_add_rule_versions v ON v.id = e.winning_rule_version_id AND v.rule_id = r.id
        WHERE e.id = ? AND e.line_account_id = ? LIMIT 1`,
    ).bind(c.req.param('id'), accountId).first<{
      id: string; friend_id: string; display_name: string | null; friend_kind: string;
      attribution_status: string; entry_route_id: string | null; entry_route_name: string | null;
      ref_code: string | null; routing_status: string; error_code: string | null;
      occurred_at: string; processed_at: string | null; rule_id: string | null; rule_name: string | null;
      version_id: string | null; version_number: number | null; definition_snapshot: string | null;
    }>();
    if (!row) return c.json({ success: false, error: '実行結果が見つかりません' }, 404);
    const definition = row.definition_snapshot ? parseSnapshot(row.definition_snapshot) : null;
    const actions = await c.env.DB.prepare(
      `SELECT id, action_stable_id, status, attempt_count, next_retry_at, last_error_code,
              created_at, updated_at
         FROM friend_add_action_runs WHERE event_id = ? ORDER BY created_at ASC, id ASC`,
    ).bind(row.id).all<{
      id: string; action_stable_id: string; status: string; attempt_count: number;
      next_retry_at: string | null; last_error_code: string | null; created_at: string; updated_at: string;
    }>();
    return c.json({
      success: true,
      data: {
        id: row.id,
        receivedAt: row.occurred_at,
        processedAt: row.processed_at,
        friend: { id: row.friend_id, displayName: row.display_name },
        friendKind: row.friend_kind,
        attribution: {
          status: row.attribution_status,
          routeId: row.entry_route_id,
          routeName: row.entry_route_name,
          reason: row.ref_code,
        },
        rule: row.rule_id ? {
          id: row.rule_id,
          name: row.rule_name,
          versionId: row.version_id,
          versionNumber: row.version_number,
          definition,
        } : null,
        configuredActions: definition?.actions ?? [],
        actionRuns: (actions.results ?? []).map((action) => ({
          id: action.id,
          stableId: action.action_stable_id,
          status: action.status,
          attemptCount: action.attempt_count,
          nextRetryAt: action.next_retry_at,
          errorCode: action.last_error_code,
          startedAt: action.created_at,
          updatedAt: action.updated_at,
        })),
        status: row.routing_status,
        errorCode: row.error_code,
      },
    });
  } catch (error) {
    console.error('GET /api/friend-add-runs/:id error:', error);
    return c.json({ success: false, error: '実行結果の詳細を取得できませんでした' }, 500);
  }
});

friendAddRules.post('/api/friend-add-rules/folders', requireRole('owner', 'admin'), async (c) => {
  const body = await c.req.json<{ accountId?: string; name?: string }>();
  const accountId = accountIdFrom(c, body);
  const name = body.name?.trim() ?? '';
  const idempotencyKey = c.req.header('Idempotency-Key');
  if (!accountId) return c.json({ success: false, error: 'accountId が必要です' }, 400);
  if (!name || name.length > 60) return c.json({ success: false, error: 'フォルダ名は1〜60文字で入力してください' }, 400);
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) {
    return c.json({ success: false, error: '保存には有効な冪等キーが必要です' }, 400);
  }
  try {
    if (!await canUseAccount(c, accountId)) return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
    const replay = await c.env.DB.prepare(
      `SELECT id, name, created_at FROM friend_add_rule_folders
        WHERE line_account_id = ? AND create_idempotency_key = ? LIMIT 1`,
    ).bind(accountId, idempotencyKey).first<{ id: string; name: string; created_at: string }>();
    if (replay) {
      return c.json({ success: true, data: { id: replay.id, name: replay.name, createdAt: replay.created_at } });
    }
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO friend_add_rule_folders
        (id, line_account_id, name, create_idempotency_key, created_by_staff_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'),
               strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))`,
    ).bind(id, accountId, name, idempotencyKey, c.get('staff').id).run();
    const created = await c.env.DB.prepare(
      `SELECT id, name, created_at FROM friend_add_rule_folders
        WHERE id = ? AND line_account_id = ?`,
    ).bind(id, accountId).first<{ id: string; name: string; created_at: string }>();
    return c.json({
      success: true,
      data: { id, name, createdAt: created?.created_at ?? null },
    }, 201);
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) {
      return c.json({ success: false, code: 'DUPLICATE_FOLDER_NAME', error: '同じ名前のフォルダがあります' }, 409);
    }
    console.error('POST /api/friend-add-rules/folders error:', error);
    return c.json({ success: false, error: 'フォルダを作成できませんでした' }, 500);
  }
});

friendAddRules.get('/api/friend-add-rules', requireRole('owner', 'admin', 'staff'), async (c) => {
  const accountId = accountIdFrom(c);
  const kind = c.req.query('kind') as FriendAddRuleKind | undefined;
  if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
  if (!kind || !KINDS.has(kind)) return c.json({ success: false, error: 'kind が正しくありません' }, 400);
  const status = c.req.query('status');
  if (status && !RULE_STATUSES.has(status)) return c.json({ success: false, error: 'status が正しくありません' }, 400);
  // 検索とフォルダ絞りはサーバ側で行う。取得済みページ内だけに効かせると
  // 21件目以降が検索に出ず、フォルダ件数もページ内の数になる。
  const search = c.req.query('q')?.trim() || undefined;
  const folder = c.req.query('folder')?.trim() || undefined;
  const limit = Number(c.req.query('limit') ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return c.json({ success: false, error: 'limit は1〜100で指定してください' }, 400);
  try {
    if (!await canUseAccount(c, accountId)) return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
    await ensureFriendAddFallbackRules(c.env.DB, accountId);
    const [page, options, summary, ruleSummary, folderCounts] = await Promise.all([
      listFriendAddRulesPage(c.env.DB, {
        lineAccountId: accountId,
        friendKind: kind,
        status: status as FriendAddRuleRow['status'] | undefined,
        cursor: c.req.query('cursor'),
        limit,
        search,
        folderName: folder,
      }),
      loadOptions(c.env.DB, accountId),
      c.env.DB.prepare(
        `SELECT
           SUM(CASE WHEN occurred_at >= strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours', '-7 days') THEN 1 ELSE 0 END) AS recent_adds,
           SUM(CASE WHEN attribution_status = 'captured' THEN 1 ELSE 0 END) AS captured,
           SUM(CASE WHEN attribution_status = 'unavailable' THEN 1 ELSE 0 END) AS unknown_route,
           SUM(CASE WHEN routing_status = 'completed' THEN 1 ELSE 0 END) AS delivered,
           SUM(CASE WHEN routing_status = 'failed' THEN 1 ELSE 0 END) AS failed
         FROM friend_add_events WHERE line_account_id = ? AND friend_kind = ?`,
      ).bind(accountId, kind).first<{
        recent_adds: number | null; captured: number | null; unknown_route: number | null;
        delivered: number | null; failed: number | null;
      }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS rules,
                SUM(CASE WHEN status = 'published' AND is_unknown_route_fallback = 0 THEN 1 ELSE 0 END) AS active
           FROM friend_add_rules
          WHERE line_account_id = ? AND friend_kind = ? AND archived_at IS NULL`,
      ).bind(accountId, kind).first<{ rules: number; active: number | null }>(),
      // フォルダ欄の件数は全ページの合計 (絞り・検索の影響を受けない)。
      c.env.DB.prepare(
        `SELECT folder_name AS folder_name, COUNT(*) AS count
           FROM friend_add_rules
          WHERE line_account_id = ? AND friend_kind = ? AND archived_at IS NULL
          GROUP BY folder_name`,
      ).bind(accountId, kind).all<{ folder_name: string | null; count: number }>(),
    ]);
    const rows = page.items;
    const routeNames = new Map(options.routes.map((route) => [route.id, route.name]));
    const scenarioNames = new Map(options.scenarios.map((scenario) => [scenario.id, scenario.name]));
    return c.json({
      success: true,
      data: {
        items: rows.map((row) => toRule(row, routeNames, scenarioNames)),
        total: page.total,
        nextCursor: page.nextCursor,
        folderCounts: (folderCounts.results ?? []).map((entry) => ({
          name: entry.folder_name,
          count: entry.count,
        })),
        summary: {
          rules: ruleSummary?.rules ?? page.total,
          active: ruleSummary?.active ?? 0,
          recentAdds: summary?.recent_adds ?? null,
          captured: summary?.captured ?? null,
          unknownRoute: summary?.unknown_route ?? null,
          delivered: summary?.delivered ?? null,
          failed: summary?.failed ?? null,
        },
        options,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'FRIEND_ADD_RULE_CURSOR_INVALID') {
      return c.json({ success: false, error: 'cursor が正しくありません' }, 400);
    }
    console.error('GET /api/friend-add-rules error:', error);
    return c.json({ success: false, error: '友だち追加時の配信を取得できませんでした' }, 500);
  }
});

friendAddRules.get('/api/friend-add-rules/conflicts', requireRole('owner', 'admin', 'staff'), async (c) => {
  const accountId = accountIdFrom(c);
  const kind = c.req.query('kind') as FriendAddRuleKind | undefined;
  if (!accountId || !kind || !KINDS.has(kind)) return c.json({ success: false, error: 'account_id と kind が必要です' }, 400);
  if (!await canUseAccount(c, accountId)) return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
  try {
    const [rows, countRows] = await Promise.all([
      listFriendAddRules(c.env.DB, { lineAccountId: accountId, friendKind: kind }),
      c.env.DB.prepare(
        `SELECT routing_rule_id AS rule_id, COUNT(*) AS count
           FROM friend_add_events
          WHERE line_account_id = ? AND friend_kind = ? AND routing_rule_id IS NOT NULL
            AND occurred_at >= strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours', '-28 days')
          GROUP BY routing_rule_id`,
      ).bind(accountId, kind).all<{ rule_id: string; count: number }>(),
    ]);
    const matched = new Map((countRows.results ?? []).map((row) => [row.rule_id, row.count]));
    const conflicts: Array<{
      code: string;
      ruleIds: string[];
      message: string;
      matchedLast28Days: Record<string, number>;
    }> = [];
    const pushConflict = (code: string, a: FriendAddRuleRow, b: FriendAddRuleRow, message: string) => {
      conflicts.push({
        code,
        ruleIds: [a.id, b.id],
        message,
        matchedLast28Days: { [a.id]: matched.get(a.id) ?? 0, [b.id]: matched.get(b.id) ?? 0 },
      });
    };
    // 定義の読み解きは1行1回だけにする。二重ループの中で毎回読むと
    // 設定が増えるほど競合確認が遅くなる (#501-軽)。
    const parsed = rows.map((row) => ({ row, definition: parseSnapshot(row.definition_snapshot) }));
    for (let left = 0; left < parsed.length; left += 1) {
      for (let right = left + 1; right < parsed.length; right += 1) {
        const a = parsed[left].row;
        const b = parsed[right].row;
        const aDefinition = parsed[left].definition;
        const bDefinition = parsed[right].definition;
        if (a.priority === b.priority) {
          pushConflict('same_priority', a, b, '同じ優先順位の設定があります。');
        }
        const aRoutes = new Set(aDefinition.routeIds);
        if (bDefinition.routeIds.some((id) => aRoutes.has(id))) {
          pushConflict('same_route', a, b, '同じ流入リンクを使う設定があります。優先順位が小さい設定だけが動きます。');
        }
        // 重なりの見方は本番の実行時評価と同じ関数。片方だけの絞り・空は競合にしない。
        if (doFriendAddWeekdaySetsOverlap(aDefinition.weekdays, bDefinition.weekdays)) {
          pushConflict('overlapping_weekday', a, b, '同じ曜日に動く設定があります。');
        }
        if (doFriendAddTimeWindowsOverlap(aDefinition.timeWindows, bDefinition.timeWindows)) {
          pushConflict('overlapping_time', a, b, '同じ時間帯に動く設定があります。');
        }
        if (areFriendAddConditionsOverlapping(aDefinition.friendCondition, bDefinition.friendCondition)) {
          pushConflict('same_friend_condition', a, b, '同じ友だち条件を使う設定があります。');
        }
      }
    }
    return c.json({
      success: true,
      data: {
        conflicts,
        rules: parsed.map(({ row, definition }) => {
          return {
            id: row.id,
            name: row.name,
            priority: row.priority,
            weekdays: definition.weekdays ?? [],
            timeWindows: definition.timeWindows ?? [],
            friendCondition: definition.friendCondition || null,
            matchedLast28Days: matched.get(row.id) ?? 0,
          };
        }),
      },
    });
  } catch (error) {
    console.error('GET /api/friend-add-rules/conflicts error:', error);
    return c.json({ success: false, error: '競合と優先順位を取得できませんでした' }, 500);
  }
});

friendAddRules.post('/api/friend-add-rules/test', requireRole('owner', 'admin', 'staff'), async (c) => {
  const body = await c.req.json<RuleTestInput>();
  const accountId = accountIdFrom(c, body);
  if (!accountId || !body.ruleId) return c.json({ success: false, error: 'accountId と ruleId が必要です' }, 400);
  if (!await canUseAccount(c, accountId)) return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
  return ruleTestResponse(c, accountId, body.ruleId);
});

friendAddRules.post('/api/friend-add-rules/drafts', requireRole('owner', 'admin'), async (c) => {
  const body = await c.req.json<RuleInput>();
  const accountId = accountIdFrom(c, body);
  const idempotencyKey = c.req.header('Idempotency-Key');
  const problem = validateInput(body);
  if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return c.json({ success: false, error: '保存には有効な冪等キーが必要です' }, 400);
  if (problem) return c.json({ success: false, error: problem }, 400);
  if (!await canUseAccount(c, accountId)) return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
  await ensureFriendAddFallbackRules(c.env.DB, accountId);
  const definition = normalizeDefinition(body.definition);
  const referenceErrors = await validateReferences(c.env.DB, accountId, definition, body.friendKind!);
  if (referenceErrors.length > 0) {
    return c.json({
      success: false,
      error: referenceErrors[0].message,
      details: referenceErrors.map((error) => error.message),
    }, 400);
  }
  const row = await createFriendAddRuleDraft(c.env.DB, {
    lineAccountId: accountId,
    friendKind: body.friendKind!,
    name: body.name!.trim(),
    folderName: body.folderName?.trim() || null,
    priority: body.priority!,
    definition,
    idempotencyKey,
  });
  return c.json({ success: true, data: { id: row.id } }, 201);
});

friendAddRules.get('/api/friend-add-rules/:id', requireRole('owner', 'admin', 'staff'), async (c) => {
  const accountId = accountIdFrom(c);
  if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
  if (!await canUseAccount(c, accountId)) return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
  const row = await getFriendAddRule(c.env.DB, { lineAccountId: accountId, ruleId: c.req.param('id') });
  if (!row) return c.json({ success: false, error: '設定が見つかりません' }, 404);
  const options = await loadOptions(c.env.DB, accountId);
  const notificationSetting = await c.env.DB.prepare(
    `SELECT value FROM account_settings
      WHERE line_account_id = ? AND key IN ('friend_add_staff_notification', 'slack_notification')
      ORDER BY CASE key WHEN 'friend_add_staff_notification' THEN 0 ELSE 1 END
      LIMIT 1`,
  ).bind(accountId).first<{ value: string }>();
  let staffNotificationStatus: 'connected' | 'disconnected' | 'unconfigured' | null = 'unconfigured';
  if (notificationSetting) {
    try {
      const setting = JSON.parse(notificationSetting.value) as { enabled?: unknown; webhookUrl?: unknown; channelId?: unknown };
      staffNotificationStatus = setting.enabled === false
        ? 'disconnected'
        : (typeof setting.webhookUrl === 'string' && setting.webhookUrl) || (typeof setting.channelId === 'string' && setting.channelId)
          ? 'connected'
          : 'unconfigured';
    } catch {
      staffNotificationStatus = null;
    }
  }
  return c.json({
    success: true,
    data: {
      rule: toRule(
        row,
        new Map(options.routes.map((route) => [route.id, route.name])),
        new Map(options.scenarios.map((scenario) => [scenario.id, scenario.name])),
      ),
      options,
      staffNotification: {
        status: staffNotificationStatus,
        reason: staffNotificationStatus === null ? '保存済みの通知設定を読み取れません' : null,
      },
    },
  });
});

friendAddRules.put('/api/friend-add-rules/:id/draft', requireRole('owner', 'admin'), async (c) => {
  const body = await c.req.json<RuleInput>();
  const accountId = accountIdFrom(c, body);
  const idempotencyKey = c.req.header('Idempotency-Key');
  const problem = validateInput(body);
  if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return c.json({ success: false, error: '保存には有効な冪等キーが必要です' }, 400);
  if (problem) return c.json({ success: false, error: problem }, 400);
  if (!await canUseAccount(c, accountId)) return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
  const current = await getFriendAddRule(c.env.DB, { lineAccountId: accountId, ruleId: c.req.param('id') });
  if (!current) return c.json({ success: false, error: '設定が見つかりません' }, 404);
  if (current.friend_kind !== body.friendKind) return c.json({ success: false, error: '判定する人は途中で変更できません' }, 400);
  const definition = normalizeDefinition(body.definition);
  const referenceErrors = await validateReferences(c.env.DB, accountId, definition, body.friendKind!);
  if (referenceErrors.length > 0) {
    return c.json({
      success: false,
      error: referenceErrors[0].message,
      details: referenceErrors.map((error) => error.message),
    }, 400);
  }
  try {
    const saved = await saveFriendAddRuleDraft(c.env.DB, {
      lineAccountId: accountId,
      ruleId: c.req.param('id'),
      name: body.name!.trim(),
      folderName: body.folderName?.trim() || null,
      priority: body.priority!,
      definition,
      idempotencyKey,
      expectedVersion: Number.isInteger(body.version) ? body.version! : current.lock_version,
    });
    return c.json({ success: true, data: { id: saved.id, versionId: saved.version_id, version: saved.lock_version } });
  } catch (error) {
    if (error instanceof Error && error.message === 'FRIEND_ADD_RULE_VERSION_CONFLICT') {
      return c.json({ success: false, code: 'VERSION_CONFLICT', error: 'ほかの画面で更新されています。最新の内容を読み直してください' }, 409);
    }
    throw error;
  }
});

friendAddRules.post('/api/friend-add-rules/:id/validate', requireRole('owner', 'admin'), async (c) => {
  const accountId = accountIdFrom(c);
  if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
  if (!await canUseAccount(c, accountId)) return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
  const row = await getFriendAddRule(c.env.DB, { lineAccountId: accountId, ruleId: c.req.param('id') });
  if (!row) return c.json({ success: false, error: '設定が見つかりません' }, 404);
  const definition = parseSnapshot(row.definition_snapshot);
  const errors = await validateReferences(c.env.DB, accountId, definition, row.friend_kind);
  /*
   * 確認は鍵付きで返す。画面は鍵で突き合わせ、説明文はサーバの値をそのまま出す。
   * 順番 (配列の位置) に意味を持たせない。
   */
  const suppressesResend = (definition.resendSuppressionHours ?? 24) > 0;
  return c.json({
    success: true,
    data: {
      canPublish: errors.length === 0 && row.version_status === 'draft',
      checks: [
        ...(errors.length === 0
          ? [{
              key: row.friend_kind,
              status: 'passed',
              label: '配信内容と参照先を確認できました。',
              detail: '保存済みのルールと参照先を確認できました。',
            }]
          : errors.map((error) => ({
              key: error.key,
              status: 'failed',
              label: error.message,
              detail: error.message,
            }))),
        {
          key: 'duplicate_prevention',
          status: suppressesResend ? 'passed' : 'warning',
          label: '二重送信防止',
          detail: '同じ友だち追加通知は1回だけ処理します。',
        },
      ],
    },
  });
});

friendAddRules.post('/api/friend-add-rules/:id/test', requireRole('owner', 'admin', 'staff'), async (c) => {
  const accountId = accountIdFrom(c);
  if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
  if (!await canUseAccount(c, accountId)) return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
  return ruleTestResponse(c, accountId, c.req.param('id'));
});

friendAddRules.post('/api/friend-add-rules/:id/publish', requireRole('owner', 'admin'), async (c) => {
  const accountId = accountIdFrom(c);
  const idempotencyKey = c.req.header('Idempotency-Key');
  if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) {
    return c.json({ success: false, error: '公開には有効な冪等キーが必要です' }, 400);
  }
  if (!await canUseAccount(c, accountId)) return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
  try {
    const row = await publishFriendAddRule(c.env.DB, {
      lineAccountId: accountId,
      ruleId: c.req.param('id'),
      staffId: c.get('staff').id,
      idempotencyKey,
    });
    return c.json({ success: true, data: { id: row.id, versionNumber: row.version_number, publishedAt: row.published_at } });
  } catch (error) {
    if (error instanceof Error && error.message === 'FRIEND_ADD_RULE_DRAFT_NOT_TESTED') {
      return c.json({ success: false, error: '公開前にテストを成功させてください' }, 409);
    }
    throw error;
  }
});

friendAddRules.post('/api/friend-add-rules/:id/stop', requireRole('owner', 'admin'), async (c) => {
  const accountId = accountIdFrom(c);
  const idempotencyKey = c.req.header('Idempotency-Key');
  if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return c.json({ success: false, error: '停止には有効な冪等キーが必要です' }, 400);
  if (!await canUseAccount(c, accountId)) return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
  let body: { version?: number } = {};
  try { body = await c.req.json<{ version?: number }>(); } catch { /* 従来クライアントは本文なし */ }
  const current = await getFriendAddRule(c.env.DB, { lineAccountId: accountId, ruleId: c.req.param('id') });
  if (!current) return c.json({ success: false, error: '設定が見つかりません' }, 404);
  try {
    await stopFriendAddRule(c.env.DB, {
      lineAccountId: accountId,
      ruleId: c.req.param('id'),
      staffId: c.get('staff').id,
      idempotencyKey,
      expectedVersion: Number.isInteger(body.version) ? body.version! : current.lock_version,
    });
    const stopped = await getFriendAddRule(c.env.DB, { lineAccountId: accountId, ruleId: c.req.param('id') });
    return c.json({ success: true, data: { version: stopped?.lock_version ?? current.lock_version } });
  } catch (error) {
    if (error instanceof Error && error.message === 'FRIEND_ADD_RULE_VERSION_CONFLICT') {
      return c.json({ success: false, code: 'VERSION_CONFLICT', error: 'ほかの画面で更新されています。最新の内容を読み直してください' }, 409);
    }
    if (error instanceof Error && error.message === 'FRIEND_ADD_RULE_NOT_STOPPED') {
      return c.json({ success: false, code: 'STATE_CONFLICT', error: 'この配信ルールは停止できる状態ではありません' }, 409);
    }
    throw error;
  }
});

friendAddRules.delete('/api/friend-add-rules/:id', requireRole('owner', 'admin'), async (c) => {
  const accountId = accountIdFrom(c);
  if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
  if (!await canUseAccount(c, accountId)) return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
  try {
    await archiveFriendAddRule(c.env.DB, { lineAccountId: accountId, ruleId: c.req.param('id') });
    return c.json({ success: true });
  } catch {
    return c.json({ success: false, error: '経路が分からなかった人の設定は削除できません' }, 409);
  }
});

export { friendAddRules };
