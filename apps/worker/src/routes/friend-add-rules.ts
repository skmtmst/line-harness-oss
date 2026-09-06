import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  archiveFriendAddRule,
  createFriendAddRuleDraft,
  ensureFriendAddFallbackRules,
  getFriendAddRule,
  listFriendAddRules,
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

const friendAddRules = new Hono<Env>();
const KINDS = new Set<FriendAddRuleKind>(['first_time', 'returning']);
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
    activeFrom: typeof definition.activeFrom === 'string' && definition.activeFrom ? definition.activeFrom : null,
    activeUntil: typeof definition.activeUntil === 'string' && definition.activeUntil ? definition.activeUntil : null,
    returningMode: definition.returningMode === 'none' || definition.returningMode === 'same' || definition.returningMode === 'other'
      ? definition.returningMode
      : undefined,
    startPosition: definition.startPosition === 'beginning' || definition.startPosition === 'resume'
      ? definition.startPosition
      : undefined,
  };
}

async function loadOptions(db: D1Database, accountId: string) {
  const [routeRows, scenarioRows, tagRows] = await Promise.all([
    db.prepare(
      `SELECT id, name, COALESCE(genre, '未分類') AS kind
         FROM entry_routes
        WHERE line_account_id = ? AND is_active = 1
        ORDER BY name ASC`,
    ).bind(accountId).all<{ id: string; name: string; kind: string }>(),
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
  ]);
  return {
    routes: routeRows.results ?? [],
    scenarios: scenarioRows.results ?? [],
    tags: tagRows.results ?? [],
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
    publishedAt: row.published_at,
    matchedLast7Days: row.matched_last_7_days,
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
  return null;
}

async function validateReferences(
  db: D1Database,
  accountId: string,
  definition: FriendAddRuleDefinition,
): Promise<string[]> {
  const messages: string[] = [];
  if (definition.routeIds.length > 0) {
    const placeholders = definition.routeIds.map(() => '?').join(',');
    const rows = await db.prepare(
      `SELECT id FROM entry_routes
        WHERE line_account_id = ? AND is_active = 1 AND id IN (${placeholders})`,
    ).bind(accountId, ...definition.routeIds).all<{ id: string }>();
    if ((rows.results ?? []).length !== new Set(definition.routeIds).size) {
      messages.push('このLINEアカウントで使えない流入リンクが含まれています。');
    }
  }
  if (definition.scenarioId) {
    const scenario = await db.prepare(
      `SELECT id FROM scenarios
        WHERE id = ? AND line_account_id = ? AND is_active = 1`,
    ).bind(definition.scenarioId, accountId).first<{ id: string }>();
    if (!scenario) messages.push('このLINEアカウントで使えないシナリオです。');
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
    if ((rows.results ?? []).length !== unique.length) messages.push('このLINEアカウントで使えないタグが含まれています。');
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
    if ((rows.results ?? []).length !== unique.length) messages.push('アクションに使えないシナリオが含まれています。');
  }
  if (definition.activeFrom && definition.activeUntil && definition.activeFrom > definition.activeUntil) {
    messages.push('有効期間の終了は開始より後にしてください。');
  }
  if (!definition.scenarioId) {
    messages.push('実際に配信するシナリオを決めてください。');
  }
  return messages;
}

async function ruleTestResponse(c: Context<Env>, accountId: string, ruleId: string) {
  const row = await getFriendAddRule(c.env.DB, { lineAccountId: accountId, ruleId });
  if (!row) return c.json({ success: false, error: '設定が見つかりません' }, 404);
  const definition = parseSnapshot(row.definition_snapshot);
  const errors = await validateReferences(c.env.DB, accountId, definition);
  if (row.version_status === 'draft') {
    await recordFriendAddRuleTest(c.env.DB, {
      lineAccountId: accountId,
      ruleId: row.id,
      staffId: c.get('staff').id,
      succeeded: errors.length === 0,
    });
  }
  return c.json({
    success: errors.length === 0,
    data: {
      stateChanged: false,
      ruleId: row.id,
      matched: errors.length === 0,
      reasons: errors.length === 0 ? ['この設定が優先順位どおりに選ばれます。'] : errors,
      scenarioId: definition.scenarioId,
      message: definition.messageText || null,
      actions: definition.actions,
    },
    ...(errors.length > 0 ? { error: 'テスト条件を確認してください' } : {}),
  }, errors.length === 0 ? 200 : 400);
}

friendAddRules.get('/api/friend-add-rules', requireRole('owner', 'admin', 'staff'), async (c) => {
  const accountId = accountIdFrom(c);
  const kind = c.req.query('kind') as FriendAddRuleKind | undefined;
  if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
  if (!kind || !KINDS.has(kind)) return c.json({ success: false, error: 'kind が正しくありません' }, 400);
  if (!await canUseAccount(c, accountId)) return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
  try {
    await ensureFriendAddFallbackRules(c.env.DB, accountId);
    const [rows, options, summary] = await Promise.all([
      listFriendAddRules(c.env.DB, { lineAccountId: accountId, friendKind: kind }),
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
    ]);
    const routeNames = new Map(options.routes.map((route) => [route.id, route.name]));
    const scenarioNames = new Map(options.scenarios.map((scenario) => [scenario.id, scenario.name]));
    return c.json({
      success: true,
      data: {
        items: rows.map((row) => toRule(row, routeNames, scenarioNames)),
        summary: {
          rules: rows.length,
          active: rows.filter((row) => row.status === 'published' && row.is_unknown_route_fallback === 0).length,
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
    console.error('GET /api/friend-add-rules error:', error);
    return c.json({ success: false, error: '友だち追加時の配信を取得できませんでした' }, 500);
  }
});

friendAddRules.get('/api/friend-add-rules/conflicts', requireRole('owner', 'admin', 'staff'), async (c) => {
  const accountId = accountIdFrom(c);
  const kind = c.req.query('kind') as FriendAddRuleKind | undefined;
  if (!accountId || !kind || !KINDS.has(kind)) return c.json({ success: false, error: 'account_id と kind が必要です' }, 400);
  if (!await canUseAccount(c, accountId)) return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
  const rows = await listFriendAddRules(c.env.DB, { lineAccountId: accountId, friendKind: kind });
  const conflicts: Array<{ code: string; ruleIds: string[]; message: string }> = [];
  for (let left = 0; left < rows.length; left += 1) {
    for (let right = left + 1; right < rows.length; right += 1) {
      const a = rows[left];
      const b = rows[right];
      if (a.priority === b.priority) {
        conflicts.push({ code: 'same_priority', ruleIds: [a.id, b.id], message: '同じ優先順位の設定があります。' });
      }
      const aRoutes = new Set(parseSnapshot(a.definition_snapshot).routeIds);
      if (parseSnapshot(b.definition_snapshot).routeIds.some((id) => aRoutes.has(id))) {
        conflicts.push({ code: 'same_route', ruleIds: [a.id, b.id], message: '同じ流入リンクを使う設定があります。優先順位が小さい設定だけが動きます。' });
      }
    }
  }
  return c.json({ success: true, data: { conflicts } });
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
  const referenceErrors = await validateReferences(c.env.DB, accountId, definition);
  if (referenceErrors.length > 0) return c.json({ success: false, error: referenceErrors[0], details: referenceErrors }, 400);
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
  return c.json({
    success: true,
    data: {
      rule: toRule(
        row,
        new Map(options.routes.map((route) => [route.id, route.name])),
        new Map(options.scenarios.map((scenario) => [scenario.id, scenario.name])),
      ),
      options,
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
  const referenceErrors = await validateReferences(c.env.DB, accountId, definition);
  if (referenceErrors.length > 0) return c.json({ success: false, error: referenceErrors[0], details: referenceErrors }, 400);
  const saved = await saveFriendAddRuleDraft(c.env.DB, {
    lineAccountId: accountId,
    ruleId: c.req.param('id'),
    name: body.name!.trim(),
    folderName: body.folderName?.trim() || null,
    priority: body.priority!,
    definition,
    idempotencyKey,
  });
  return c.json({ success: true, data: { id: saved.id, versionId: saved.version_id } });
});

friendAddRules.post('/api/friend-add-rules/:id/validate', requireRole('owner', 'admin'), async (c) => {
  const accountId = accountIdFrom(c);
  if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
  if (!await canUseAccount(c, accountId)) return c.json({ success: false, error: '対象のLINEアカウントが見つかりません' }, 404);
  const row = await getFriendAddRule(c.env.DB, { lineAccountId: accountId, ruleId: c.req.param('id') });
  if (!row) return c.json({ success: false, error: '設定が見つかりません' }, 404);
  const errors = await validateReferences(c.env.DB, accountId, parseSnapshot(row.definition_snapshot));
  return c.json({
    success: true,
    data: {
      canPublish: errors.length === 0 && row.version_status === 'draft',
      checks: errors.length === 0
        ? [{ status: 'passed', label: '配信内容と参照先を確認できました。' }]
        : errors.map((message) => ({ status: 'failed', label: message })),
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
  await stopFriendAddRule(c.env.DB, { lineAccountId: accountId, ruleId: c.req.param('id') });
  return c.json({ success: true });
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
