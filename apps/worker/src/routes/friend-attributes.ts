import { Hono, type Context } from 'hono';
import {
  getSupportMarksWithUsage,
  getSupportMarkArchiveImpact,
  getSupportMarkById,
  createSupportMarkWithAutomationRules,
  updateSupportMark,
  replaceAndArchiveSupportMark,
  archiveSupportMarkWithReplacement,
  SupportMarkArchiveError,
  getDefaultSupportMark,
  setFriendSupportMark,
  setFriendSupportMarkBulk,
  getSavedSearches,
  getSavedSearchById,
  createSavedSearch,
  updateSavedSearchWithRevision,
  deleteSavedSearch,
  countSavedSearches,
  getSavedSearchReferences,
  getSavedSearchUsageCounts,
  getSavedSearchReferenceUsageCounts,
  jstNow,
  validateSearchConditions,
  validateSavedSegmentConditions,
  SAVED_SEARCH_LIMIT,
  getLoginAudit,
  getStaffMembers,
  LOGIN_AUDIT_ACTIONS,
  type LoginAuditRow,
  type LoginAuditAction,
  getFolders,
  getFolderById,
  createFolder,
  updateFolder,
  deleteFolder,
  isFolderKind,
  getWebinarFolderCounts,
  type SupportMark,
  type SupportMarkWithUsage,
  type SupportMarkScope,
  type SavedSearch,
  type SavedSearchAccess,
  type SavedSearchConditionFormat,
  type SavedSearchReference,
  type Folder,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';
import {
  getSavedSearchMatchInsights,
  getSavedSearchMatchPreview,
  type SavedSearchMatchInsight,
  type SavedSearchMatchPreview,
} from '../services/saved-search-insights.js';
import {
  archiveSupportMarkAutomationRule,
  createSupportMarkAutomationRule,
  listSupportMarkAutomationRules,
  listSupportMarkAutomationRulesForAccount,
  SUPPORT_MARK_RULE_EVENTS,
  updateSupportMarkAutomationRule,
  validateSupportMarkAutomationRuleInput,
  type SaveSupportMarkAutomationRule,
  type SupportMarkRuleEvent,
} from '../services/support-mark-automation.js';
import { buildSegmentWhere, type SegmentCondition } from '../services/segment-query.js';

/**
 * 対応マーク・保存した検索・汎用フォルダ。
 *
 * 3つとも「友だち属性」の画面の中のタブなので、1つのルータにまとめている。
 * どれも小さく、別ファイルに散らすと登録漏れの方が起きやすい。
 */
const friendAttributes = new Hono<Env>();

const SUPPORT_MARK_DISPLAY_TARGETS = ['inbox', 'friend_list', 'friend_detail'] as const;

function serializeMark(
  row: SupportMark,
  automationRules: Awaited<ReturnType<typeof listSupportMarkAutomationRulesForAccount>> = [],
) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    isDefault: Boolean(row.is_default),
    autoOnInbound: Boolean(row.auto_on_inbound),
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    version: Number(row.version ?? 1),
    isInherited: Boolean(row.is_inherited),
    automationRules,
    displayTargets: SUPPORT_MARK_DISPLAY_TARGETS,
  };
}

function serializeMarkImpact(row: SupportMarkWithUsage) {
  return {
    friendCount: Number(row.friend_count),
    usedIn: {
      broadcasts: Number(row.broadcasts),
      scenarios: Number(row.scenarios),
      autoReplies: Number(row.auto_replies),
      savedSearches: Number(row.saved_searches),
      automations: Number(row.automations),
    },
  };
}

function markReferenceCount(row: SupportMarkWithUsage): number {
  return Number(row.broadcasts)
    + Number(row.scenarios)
    + Number(row.auto_replies)
    + Number(row.saved_searches)
    + Number(row.automations);
}

function sameMarkImpact(
  expected: unknown,
  current: ReturnType<typeof serializeMarkImpact>,
): boolean {
  if (!expected || typeof expected !== 'object') return false;
  const value = expected as { friendCount?: unknown; usedIn?: Record<string, unknown> };
  return Number(value.friendCount) === current.friendCount
    && Number(value.usedIn?.broadcasts) === current.usedIn.broadcasts
    && Number(value.usedIn?.scenarios) === current.usedIn.scenarios
    && Number(value.usedIn?.autoReplies) === current.usedIn.autoReplies
    && Number(value.usedIn?.savedSearches) === current.usedIn.savedSearches
    && Number(value.usedIn?.automations) === current.usedIn.automations;
}

async function supportMarkAccess(c: Context<Env>): Promise<SupportMarkScope | Response> {
  const lineAccountId = c.req.query('lineAccountId');
  if (!lineAccountId) {
    return c.json({ success: false, error: 'LINE公式アカウントを選んでください' }, 400);
  }
  const staff = c.get('staff');
  if (!staff.tenantId) {
    return c.json({ success: false, error: '所属を確認できません' }, 403);
  }
  const accountScope = await getVisibleLineAccountScope(c.env.DB, staff);
  if (!accountScope.allowedAccountIds.includes(lineAccountId)) {
    // 権限の有無からアカウントの存在を推測させない。
    return c.json({ success: false, error: '対応マークが見つかりません' }, 404);
  }
  return { tenantId: staff.tenantId, lineAccountId };
}

function serializeSearch(
  row: SavedSearch,
  insight: SavedSearchMatchInsight = { matchCount: null, matchCountError: null },
  references: SavedSearchReference[] = [],
  callCountThisMonth = 0,
  referenceCallCounts: ReadonlyMap<string, number> = new Map(),
) {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    conditionFormat: row.condition_format ?? 'search_v1',
    conditions: JSON.parse(row.conditions_json) as unknown,
    createdBy: row.created_by,
    lineAccountId: row.line_account_id,
    isShared: Boolean(row.is_shared),
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedBy: row.updated_by ?? row.created_by,
    updatedAt: row.updated_at ?? row.created_at,
    revision: Number(row.revision ?? 1),
    matchCount: insight.matchCount,
    matchCountError: insight.matchCountError,
    callCountThisMonth,
    usedIn: references.map((reference) => ({
      kind: reference.reference_kind,
      id: reference.reference_id,
      name: reference.reference_name,
      mode: reference.reference_mode,
      revision: reference.revision,
      lastUsedAt: reference.last_used_at,
      callCountThisMonth: referenceCallCounts.get(
        `${reference.saved_search_id}:${reference.reference_kind}:${reference.reference_id}`,
      ) ?? 0,
    })),
    canDelete: references.length === 0,
  };
}

async function savedSearchAccess(
  c: Context<Env>,
  requestedLineAccountId?: string,
): Promise<SavedSearchAccess | Response> {
  const lineAccountId = requestedLineAccountId ?? c.req.query('lineAccountId');
  if (!lineAccountId) {
    return c.json({ success: false, error: 'LINE公式アカウントを選んでください' }, 400);
  }
  const accountScope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  if (!accountScope.allowedAccountIds.includes(lineAccountId)) {
    return c.json({ success: false, error: '保存した検索が見つかりません' }, 404);
  }
  const staff = c.get('staff');
  return {
    lineAccountId,
    staffId: staff.id,
    canManageAll: staff.role === 'owner' || staff.role === 'admin',
  } satisfies SavedSearchAccess;
}

function canReadSavedSearch(row: SavedSearch, access: SavedSearchAccess): boolean {
  return row.scope === 'friends'
    && (row.condition_format ?? 'search_v1') === 'search_v1'
    && row.line_account_id === access.lineAccountId
    && (access.canManageAll || Boolean(row.is_shared) || row.created_by === access.staffId);
}

function savedSearchReferenceMap(references: SavedSearchReference[]) {
  const bySearch = new Map<string, SavedSearchReference[]>();
  for (const reference of references) {
    const current = bySearch.get(reference.saved_search_id) ?? [];
    current.push(reference);
    bySearch.set(reference.saved_search_id, current);
  }
  return bySearch;
}

function savedSearchDetail(
  row: SavedSearch,
  match: SavedSearchMatchPreview,
  references: SavedSearchReference[],
  callCountThisMonth: number,
  referenceCallCounts: ReadonlyMap<string, number>,
  access: SavedSearchAccess,
) {
  const serialized = serializeSearch(
    row,
    { matchCount: match.total, matchCountError: match.error },
    references,
    callCountThisMonth,
    referenceCallCounts,
  );
  return {
    ...serialized,
    accountScope: { type: 'line_account' as const, id: access.lineAccountId },
    owner: {
      id: row.created_by,
      isCurrentUser: row.created_by === access.staffId,
    },
    match,
  };
}

function positiveInteger(raw: string | undefined, fallback: number, max: number): number | null {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value <= max ? value : null;
}

function nonNegativeInteger(raw: string | undefined, fallback = 0): number | null {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

async function savedSearchMatchForRow(
  db: D1Database,
  row: SavedSearch,
  lineAccountId: string,
): Promise<SavedSearchMatchPreview> {
  let raw: unknown;
  try {
    raw = JSON.parse(row.conditions_json);
  } catch {
    return {
      total: null,
      byChannel: { line: null, mail: null },
      calculatedAt: jstNow(),
      error: '条件のJSONが壊れています',
    };
  }
  const conditions = validateSearchConditions(raw);
  if (!conditions.ok) {
    return {
      total: null,
      byChannel: { line: null, mail: null },
      calculatedAt: jstNow(),
      error: conditions.error,
    };
  }
  return getSavedSearchMatchPreview(db, conditions.value, lineAccountId);
}

const MANAGED_CONDITION_FORMATS = ['search_v1', 'segment_v1'] as const;

/** 同じfriends向けでも、旧検索と配信対象のJSON形式を明示して分ける。 */
function requestedConditionFormat(c: Context<Env>): SavedSearchConditionFormat | Response {
  const raw = c.req.query('format') ?? 'search_v1';
  if (!(MANAGED_CONDITION_FORMATS as readonly string[]).includes(raw)) {
    return c.json({ success: false, error: '保存した条件の形式が正しくありません' }, 400);
  }
  return raw as SavedSearchConditionFormat;
}

type StoredSavedConditions = Parameters<typeof createSavedSearch>[1]['conditions'];

/** 保存と実送信で同じ評価器を通し、読めない条件をDBへ入れない。 */
function validateConditionsForFormat(
  format: SavedSearchConditionFormat,
  raw: unknown,
): { ok: true; value: StoredSavedConditions } | { ok: false; error: string } {
  if (format === 'search_v1') return validateSearchConditions(raw);
  const parsed = validateSavedSegmentConditions(raw);
  if (!parsed.ok) return parsed;
  try {
    buildSegmentWhere(parsed.value.condition as SegmentCondition);
  } catch {
    return { ok: false, error: '保存した対象条件を確認してください' };
  }
  return parsed;
}

function serializeFolder(row: Folder, count?: number) {
  return {
    id: row.id,
    kind: row.kind,
    accountId: row.account_id ?? null,
    name: row.name,
    parentId: row.parent_id,
    displayOrder: row.display_order,
    color: row.color ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(count === undefined ? {} : { count }),
  };
}

/** 色は #RRGGBB だけ許す。名前付きの色を混ぜると、画面での見た目が揃わない。 */
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function supportMarkRuleInput(body: Record<string, unknown>): SaveSupportMarkAutomationRule | null {
  const event = body.event;
  const priority = Number(body.priority ?? 0);
  const manualProtectionMinutes = Number(body.manualProtectionMinutes ?? 0);
  if (typeof body.name !== 'string'
    || !SUPPORT_MARK_RULE_EVENTS.includes(event as SupportMarkRuleEvent)
    || !Number.isInteger(priority)
    || !Number.isInteger(manualProtectionMinutes)) return null;
  return {
    name: body.name,
    event: event as SupportMarkRuleEvent,
    condition: body.condition === null || body.condition === undefined
      ? null
      : body.condition as SegmentCondition,
    priority,
    manualProtectionMinutes,
    isActive: body.isActive !== false,
  };
}

/**
 * IPの末尾を伏せる。
 *
 * 監査で見たいのは「いつもと違うところから入っていないか」で、
 * 完全な値は要らない。画面に出す以上、出す量は少ない方がよい。
 */
function maskIp(ip: string): string {
  if (ip.includes(':')) {
    // IPv6。前半だけ残す。
    const parts = ip.split(':');
    return parts.slice(0, 3).join(':') + ':***';
  }
  const parts = ip.split('.');
  if (parts.length !== 4) return '***';
  return `${parts[0]}.${parts[1]}.${parts[2]}.***`;
}

// ── 対応マーク ──────────────────────────────────────────────

friendAttributes.get('/api/support-marks', async (c) => {
  try {
    const scope = await supportMarkAccess(c);
    if (scope instanceof Response) return scope;
    const [marks, rules] = await Promise.all([
      getSupportMarksWithUsage(c.env.DB, scope),
      listSupportMarkAutomationRulesForAccount(c.env.DB, scope),
    ]);
    const rulesByMark = new Map<string, typeof rules>();
    for (const rule of rules) {
      rulesByMark.set(rule.markId, [...(rulesByMark.get(rule.markId) ?? []), rule]);
    }
    const withCounts = marks.map((mark) => ({
        ...serializeMark(mark, rulesByMark.get(mark.id) ?? []),
        friendCount: Number(mark.friend_count),
        usedIn: {
          broadcasts: Number(mark.broadcasts),
          scenarios: Number(mark.scenarios),
          autoReplies: Number(mark.auto_replies),
          savedSearches: Number(mark.saved_searches),
          automations: Number(mark.automations),
        },
      }));
    return c.json({ success: true, data: withCounts });
  } catch (err) {
    console.error('GET /api/support-marks error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friendAttributes.post('/api/support-marks', requireRole('owner', 'admin'), async (c) => {
  try {
    const scope = await supportMarkAccess(c);
    if (scope instanceof Response) return scope;
    const body = await c.req.json<Record<string, unknown>>();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return c.json({ success: false, error: 'マークの名前を入力してください' }, 400);
    if (body.color !== undefined && !COLOR_PATTERN.test(String(body.color))) {
      return c.json({ success: false, error: '色は #RRGGBB の形で指定してください' }, 400);
    }
    const displayOrder = Number(body.displayOrder ?? 0);
    if (!Number.isInteger(displayOrder) || displayOrder < 0 || displayOrder > 10_000) {
      return c.json({ success: false, error: '並び順は0〜10000の整数で指定してください' }, 400);
    }
    const automationValues = body.automationRules ?? [];
    if (!Array.isArray(automationValues) || automationValues.length > 20) {
      return c.json({ success: false, error: '自動変更ルールは20件以内で指定してください' }, 400);
    }
    const automationRules = automationValues.map((value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? supportMarkRuleInput(value as Record<string, unknown>)
        : null);
    if (automationRules.some((rule) => rule === null)) {
      return c.json({ success: false, error: '自動変更ルールの入力が正しくありません' }, 400);
    }
    try {
      for (const rule of automationRules) validateSupportMarkAutomationRuleInput(rule!);
    } catch {
      return c.json({ success: false, error: '自動変更ルールの入力が正しくありません' }, 422);
    }
    const mark = await createSupportMarkWithAutomationRules(c.env.DB, scope, {
      name,
      color: body.color ? String(body.color) : undefined,
      isDefault: body.isDefault === true,
      autoOnInbound: body.autoOnInbound === true,
      displayOrder,
    }, c.get('staff').id, automationRules as SaveSupportMarkAutomationRule[]);
    const createdRules = await listSupportMarkAutomationRules(c.env.DB, scope, mark.id) ?? [];
    return c.json({ success: true, data: serializeMark(mark, createdRules) }, 201);
  } catch (err) {
    console.error('POST /api/support-marks error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friendAttributes.patch('/api/support-marks/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const scope = await supportMarkAccess(c);
    if (scope instanceof Response) return scope;
    const id = c.req.param('id');
    const existing = await getSupportMarkById(c.env.DB, id, scope);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    const body = await c.req.json<Record<string, unknown>>();
    if (body.color !== undefined && !COLOR_PATTERN.test(String(body.color))) {
      return c.json({ success: false, error: '色は #RRGGBB の形で指定してください' }, 400);
    }
    // 既定を外す操作は止める。既定が1つも無いと、新しい友だちに何も付かない。
    // 別のマークを既定にすれば、こちらは自動で外れる。
    if (body.isDefault === false && existing.is_default === 1) {
      return c.json(
        {
          success: false,
          error:
            '既定のマークを外すことはできません。別のマークを既定にすると、こちらは自動で外れます。',
        },
        409,
      );
    }
    if (existing.is_inherited === 1) {
      const current = (await getSupportMarksWithUsage(c.env.DB, scope))
        .find((mark) => mark.id === id);
      if (!current || markReferenceCount(current) > 0) {
        return c.json(
          {
            success: false,
            error: '使用先がある共有マークは直接編集できません。使用先を別のマークへ変更してから編集してください。',
            code: 'INHERITED_MARK_IN_USE',
          },
          409,
        );
      }
    }
    const mark = await updateSupportMark(c.env.DB, id, scope, {
      name: body.name === undefined ? undefined : String(body.name).trim(),
      color: body.color === undefined ? undefined : String(body.color),
      isDefault: body.isDefault === undefined ? undefined : body.isDefault === true,
      autoOnInbound: body.autoOnInbound === undefined ? undefined : body.autoOnInbound === true,
      displayOrder: body.displayOrder === undefined ? undefined : Number(body.displayOrder),
      actorId: c.get('staff').id,
    });
    return c.json({ success: true, data: serializeMark(mark!) });
  } catch (err) {
    console.error('PATCH /api/support-marks/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friendAttributes.get(
  '/api/support-marks/:id/automation-rules',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const scope = await supportMarkAccess(c);
      if (scope instanceof Response) return scope;
      const rules = await listSupportMarkAutomationRules(c.env.DB, scope, c.req.param('id'));
      if (!rules) return c.json({ success: false, error: '対応マークが見つかりません' }, 404);
      return c.json({ success: true, data: rules });
    } catch (err) {
      console.error('GET /api/support-marks/:id/automation-rules error:', err);
      return c.json({ success: false, error: '自動変更ルールを読み込めませんでした' }, 500);
    }
  },
);

friendAttributes.post(
  '/api/support-marks/:id/automation-rules',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const scope = await supportMarkAccess(c);
      if (scope instanceof Response) return scope;
      const input = supportMarkRuleInput(await c.req.json<Record<string, unknown>>());
      if (!input) return c.json({ success: false, error: '自動変更ルールの入力が正しくありません' }, 400);
      const rule = await createSupportMarkAutomationRule(
        c.env.DB, scope, c.req.param('id'), c.get('staff').id, input,
      );
      if (!rule) return c.json({ success: false, error: '対応マークが見つかりません' }, 404);
      return c.json({ success: true, data: rule }, 201);
    } catch (err) {
      const reason = err instanceof Error ? err.message : '';
      if (reason.startsWith('rule_') || reason === 'manual_protection_invalid') {
        return c.json({ success: false, error: '自動変更ルールの入力が正しくありません' }, 422);
      }
      console.error('POST /api/support-marks/:id/automation-rules error:', err);
      return c.json({ success: false, error: '自動変更ルールを保存できませんでした' }, 500);
    }
  },
);

friendAttributes.patch(
  '/api/support-mark-rules/:ruleId',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const scope = await supportMarkAccess(c);
      if (scope instanceof Response) return scope;
      const body = await c.req.json<Record<string, unknown>>();
      const input = supportMarkRuleInput(body);
      const expectedVersion = Number(body.expectedVersion);
      if (!input || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
        return c.json({ success: false, error: '最新の版を指定してください' }, 400);
      }
      const result = await updateSupportMarkAutomationRule(
        c.env.DB, scope, c.req.param('ruleId'), c.get('staff').id, expectedVersion, input,
      );
      if (result === 'not_found') return c.json({ success: false, error: '自動変更ルールが見つかりません' }, 404);
      if (result === 'conflict') return c.json({
        success: false,
        error: 'ほかの担当者が先に変更しました。最新の内容を読み直してください',
        code: 'SUPPORT_MARK_RULE_VERSION_CONFLICT',
      }, 409);
      return c.json({ success: true, data: result });
    } catch (err) {
      const reason = err instanceof Error ? err.message : '';
      if (reason.startsWith('rule_') || reason === 'manual_protection_invalid') {
        return c.json({ success: false, error: '自動変更ルールの入力が正しくありません' }, 422);
      }
      console.error('PATCH /api/support-mark-rules/:ruleId error:', err);
      return c.json({ success: false, error: '自動変更ルールを保存できませんでした' }, 500);
    }
  },
);

friendAttributes.delete(
  '/api/support-mark-rules/:ruleId',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const scope = await supportMarkAccess(c);
      if (scope instanceof Response) return scope;
      let body: { expectedVersion?: unknown } = {};
      try {
        body = await c.req.json<{ expectedVersion?: unknown }>();
      } catch {
        // 本文なしは版未指定として、下の安定した400へ揃える。
      }
      const expectedVersion = Number(body.expectedVersion);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
        return c.json({ success: false, error: '最新の版を指定してください' }, 400);
      }
      const result = await archiveSupportMarkAutomationRule(
        c.env.DB, scope, c.req.param('ruleId'), expectedVersion,
      );
      if (result === 'not_found') return c.json({ success: false, error: '自動変更ルールが見つかりません' }, 404);
      if (result === 'conflict') return c.json({
        success: false,
        error: 'ほかの担当者が先に変更しました。最新の内容を読み直してください',
        code: 'SUPPORT_MARK_RULE_VERSION_CONFLICT',
      }, 409);
      return c.json({ success: true, data: null });
    } catch (err) {
      console.error('DELETE /api/support-mark-rules/:ruleId error:', err);
      return c.json({ success: false, error: '自動変更ルールを停止できませんでした' }, 500);
    }
  },
);

friendAttributes.get(
  '/api/support-marks/:id/archive-impact',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const scope = await supportMarkAccess(c);
      if (scope instanceof Response) return scope;
      const impact = await getSupportMarkArchiveImpact(c.env.DB, scope, c.req.param('id'));
      if (!impact) return c.json({ success: false, error: '対応マークが見つかりません' }, 404);
      const [rules, marks] = await Promise.all([
        listSupportMarkAutomationRules(c.env.DB, scope, impact.mark.id),
        getSupportMarksWithUsage(c.env.DB, scope),
      ]);
      return c.json({
        success: true,
        data: {
          mark: serializeMark(impact.mark, rules ?? []),
          ...serializeMarkImpact(impact.mark),
          automationRules: rules ?? [],
          displayTargets: SUPPORT_MARK_DISPLAY_TARGETS,
          replacementOptions: marks
            .filter((mark) => mark.id !== impact.mark.id && mark.is_inherited !== 1)
            .map((mark) => serializeMark(mark)),
          canArchive: impact.canArchive,
          impactRevision: impact.revision,
          checkedAt: impact.checkedAt,
          expectedVersion: Number(impact.mark.version ?? 1),
        },
      });
    } catch (err) {
      console.error('GET /api/support-marks/:id/archive-impact error:', err);
      return c.json({ success: false, error: '保管の影響を確認できませんでした' }, 500);
    }
  },
);

friendAttributes.post(
  '/api/support-marks/:id/archive',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const scope = await supportMarkAccess(c);
      if (scope instanceof Response) return scope;
      const idempotencyKey = c.req.header('Idempotency-Key')?.trim() ?? '';
      if (!idempotencyKey || idempotencyKey.length > 128) {
        return c.json({ success: false, error: 'Idempotency-Keyを指定してください' }, 400);
      }
      const body = await c.req.json<Record<string, unknown>>();
      const replacementMarkId = typeof body.replacementMarkId === 'string'
        ? body.replacementMarkId.trim()
        : '';
      const impactRevision = typeof body.impactRevision === 'string'
        ? body.impactRevision.trim()
        : '';
      const expectedVersion = Number(body.expectedVersion);
      if (!replacementMarkId || !impactRevision
        || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
        return c.json({ success: false, error: '置換先・確認版・現在版を指定してください' }, 400);
      }
      const result = await archiveSupportMarkWithReplacement(c.env.DB, scope, {
        markId: c.req.param('id'),
        replacementMarkId,
        expectedVersion,
        impactRevision,
        idempotencyKey,
        actorId: c.get('staff').id,
      });
      const replacement = await getSupportMarkById(c.env.DB, replacementMarkId, scope);
      return c.json({
        success: true,
        data: {
          ...result,
          replacementMark: replacement ? serializeMark(replacement) : null,
        },
      });
    } catch (err) {
      if (err instanceof SupportMarkArchiveError) {
        const status = err.code === 'not_found' ? 404 : 409;
        return c.json({ success: false, code: err.code, error: err.message }, status);
      }
      console.error('POST /api/support-marks/:id/archive error:', err);
      return c.json({ success: false, error: '対応マークを保管できませんでした' }, 500);
    }
  },
);

friendAttributes.delete('/api/support-marks/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const scope = await supportMarkAccess(c);
    if (scope instanceof Response) return scope;
    const id = c.req.param('id');
    const existing = await getSupportMarkById(c.env.DB, id, scope);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    if (existing.is_inherited === 1) {
      return c.json(
        {
          success: false,
          error: '共通マークは削除できません。編集すると、このLINE公式アカウント専用になります。',
        },
        409,
      );
    }
    if (existing.is_default === 1) {
      return c.json(
        {
          success: false,
          error: '既定のマークは削除できません。先に別のマークを既定にしてください。',
        },
        409,
      );
    }
    const defaultMark = await getDefaultSupportMark(c.env.DB, scope);
    if (!defaultMark || defaultMark.id === id) {
      return c.json(
        {
          success: false,
          error: '置換先の初期値マークがありません。先に別のマークを初期値にしてください。',
        },
        409,
      );
    }

    const current = (await getSupportMarksWithUsage(c.env.DB, scope))
      .find((mark) => mark.id === id);
    if (!current) {
      return c.json(
        { success: false, error: '影響を確認できませんでした。状態を読み直してください。' },
        409,
      );
    }
    const impact = serializeMarkImpact(current);
    if (markReferenceCount(current) > 0) {
      return c.json(
        {
          success: false,
          error: 'このマークは配信などで使われています。先にすべての使用先から外してください。',
          code: 'REFERENCED',
          ...impact,
        },
        409,
      );
    }
    const body: Record<string, unknown> = await c.req
      .json<Record<string, unknown>>()
      .catch(() => ({}));
    const replacementMarkId = typeof body.replacementMarkId === 'string'
      ? body.replacementMarkId
      : '';
    if (replacementMarkId !== defaultMark.id) {
      return c.json(
        {
          success: false,
          error: `置換先を「${defaultMark.name}」にして、もう一度影響を確認してください。`,
          code: 'REPLACEMENT_REQUIRED',
          ...impact,
          replacementMark: serializeMark(defaultMark),
        },
        409,
      );
    }
    if (!sameMarkImpact(body.expectedImpact, impact)) {
      return c.json(
        {
          success: false,
          error: '確認後に使用状況が変わりました。最新の影響を確認してください。',
          code: 'IMPACT_CHANGED',
          ...impact,
          replacementMark: serializeMark(defaultMark),
        },
        409,
      );
    }
    const staff = c.get('staff');
    const replacedFriendCount = await replaceAndArchiveSupportMark(
      c.env.DB,
      id,
      defaultMark.id,
      scope,
      staff.id,
    );
    return c.json({
      success: true,
      data: {
        archived: true,
        replacedFriendCount,
        replacementMark: serializeMark(defaultMark),
      },
    });
  } catch (err) {
    console.error('DELETE /api/support-marks/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friendAttributes.patch(
  '/api/friends/:id/support-mark',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    try {
      const scope = await supportMarkAccess(c);
      if (scope instanceof Response) return scope;
      const body = await c.req.json<{ markId?: unknown }>();
      const markId =
        body.markId === null || body.markId === '' || body.markId === undefined
          ? null
          : String(body.markId);
      if (markId) {
        const mark = await getSupportMarkById(c.env.DB, markId, scope);
        if (!mark) return c.json({ success: false, error: 'マークが見つかりません' }, 400);
      }
      const updated = await setFriendSupportMark(
        c.env.DB,
        c.req.param('id'),
        markId,
        scope,
        c.get('staff').id,
      );
      if (!updated) return c.json({ success: false, error: '友だちが見つかりません' }, 404);
      return c.json({ success: true, data: null });
    } catch (err) {
      console.error('PATCH /api/friends/:id/support-mark error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

friendAttributes.post(
  '/api/friends/support-mark/bulk',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    try {
      const scope = await supportMarkAccess(c);
      if (scope instanceof Response) return scope;
      const body = await c.req.json<{ friendIds?: unknown; markId?: unknown }>();
      const friendIds = Array.isArray(body.friendIds) ? body.friendIds.map(String) : [];
      if (friendIds.length === 0) {
        return c.json({ success: false, error: '対象の友だちが選ばれていません' }, 400);
      }
      if (friendIds.length > 1000) {
        return c.json({ success: false, error: '一度に変更できるのは1000人までです' }, 422);
      }
      const markId =
        body.markId === null || body.markId === '' || body.markId === undefined
          ? null
          : String(body.markId);
      if (markId && !(await getSupportMarkById(c.env.DB, markId, scope))) {
        return c.json({ success: false, error: 'マークが見つかりません' }, 400);
      }
      const updated = await setFriendSupportMarkBulk(c.env.DB, friendIds, markId, scope);
      return c.json({ success: true, data: { updated } });
    } catch (err) {
      console.error('POST /api/friends/support-mark/bulk error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

// ── 保存した検索 ────────────────────────────────────────────

friendAttributes.get('/api/saved-searches', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const format = requestedConditionFormat(c);
    if (format instanceof Response) return format;
    const owner = c.req.query('owner') ?? 'all';
    const usage = c.req.query('usage') ?? 'all';
    const match = c.req.query('match') ?? 'all';
    if (!['all', 'me'].includes(owner)
      || !['all', 'used', 'unused'].includes(usage)
      || !['all', 'matched', 'zero'].includes(match)) {
      return c.json({ success: false, error: '一覧の絞り込み条件が正しくありません' }, 400);
    }
    const limit = positiveInteger(c.req.query('limit'), 20, 50);
    const offset = nonNegativeInteger(c.req.query('cursor'));
    if (limit === null || offset === null) {
      return c.json({ success: false, error: 'ページ位置が正しくありません' }, 400);
    }
    const access = await savedSearchAccess(c);
    if (access instanceof Response) return access;
    const items = await getSavedSearches(c.env.DB, 'friends', access, format);
    const visible = items.filter((row) =>
      row.scope === 'friends' && (row.condition_format ?? 'search_v1') === format
      && (row.line_account_id === access.lineAccountId
        ? access.canManageAll || Boolean(row.is_shared) || row.created_by === access.staffId
        : row.line_account_id === null && row.created_by === access.staffId));
    const ids = visible.map((row) => row.id);
    const [insights, references, callCounts, referenceCallCounts] = await Promise.all([
      format === 'search_v1'
        ? getSavedSearchMatchInsights(c.env.DB, visible, access.lineAccountId)
        : Promise.resolve(new Map<string, SavedSearchMatchInsight>()),
      getSavedSearchReferences(c.env.DB, ids, access.lineAccountId),
      getSavedSearchUsageCounts(c.env.DB, ids, access.lineAccountId),
      getSavedSearchReferenceUsageCounts(c.env.DB, ids, access.lineAccountId),
    ]);
    const referencesBySearch = savedSearchReferenceMap(references);
    const serialized = visible.map((row) => serializeSearch(
      row,
      insights.get(row.id),
      referencesBySearch.get(row.id),
      callCounts.get(row.id) ?? 0,
      referenceCallCounts,
    ));
    const query = (c.req.query('query') ?? '').trim().toLocaleLowerCase('ja-JP');
    const ownerScoped = serialized.filter(
      (item) => owner !== 'me' || item.createdBy === access.staffId,
    );
    const filtered = ownerScoped.filter((item) => {
      if (query && ![
        item.name,
        ...item.usedIn.map((reference) => reference.name),
      ].some((value) => value.toLocaleLowerCase('ja-JP').includes(query))) return false;
      if (usage === 'used' && item.usedIn.length === 0) return false;
      if (usage === 'unused' && item.usedIn.length > 0) return false;
      if (match === 'matched' && !(typeof item.matchCount === 'number' && item.matchCount > 0)) return false;
      if (match === 'zero' && item.matchCount !== 0) return false;
      return true;
    });
    const page = filtered.slice(offset, offset + limit);
    const summary = {
      total: ownerScoped.length,
      usedInBroadcasts: ownerScoped.filter((item) =>
        item.usedIn.some((reference) => reference.kind === 'broadcast')).length,
      zeroMatches: ownerScoped.filter((item) => item.matchCount === 0).length,
      callsThisMonth: ownerScoped.reduce((total, item) => total + item.callCountThisMonth, 0),
    };
    const pagination = {
      total: filtered.length,
      limit,
      cursor: String(offset),
      nextCursor: offset + limit < filtered.length ? String(offset + limit) : null,
    };
    return c.json({
      success: true,
      // data は既存画面との互換性のため配列のまま維持する。
      data: page,
      items: page,
      summary,
      pagination,
    });
  } catch (err) {
    console.error('GET /api/saved-searches error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friendAttributes.get(
  '/api/saved-searches/:id',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    try {
      const access = await savedSearchAccess(c);
      if (access instanceof Response) return access;
      const row = await getSavedSearchById(c.env.DB, c.req.param('id'), access.lineAccountId);
      if (!row || !canReadSavedSearch(row, access)) {
        return c.json({ success: false, error: '保存した検索が見つかりません' }, 404);
      }
      const [match, references, callCounts, referenceCallCounts] = await Promise.all([
        savedSearchMatchForRow(c.env.DB, row, access.lineAccountId),
        getSavedSearchReferences(c.env.DB, [row.id], access.lineAccountId),
        getSavedSearchUsageCounts(c.env.DB, [row.id], access.lineAccountId),
        getSavedSearchReferenceUsageCounts(c.env.DB, [row.id], access.lineAccountId),
      ]);
      return c.json({
        success: true,
        data: savedSearchDetail(
          row,
          match,
          references,
          callCounts.get(row.id) ?? 0,
          referenceCallCounts,
          access,
        ),
      });
    } catch (err) {
      console.error('GET /api/saved-searches/:id error:', err);
      return c.json({ success: false, error: '保存した検索を読み込めませんでした' }, 500);
    }
  },
);

friendAttributes.post(
  '/api/saved-searches/preview',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();
      const requestedAccount = typeof body.lineAccountId === 'string'
        ? body.lineAccountId.trim()
        : undefined;
      const access = await savedSearchAccess(c, requestedAccount);
      if (access instanceof Response) return access;
      const savedSearchId = typeof body.savedSearchId === 'string'
        ? body.savedSearchId.trim()
        : '';
      const row = savedSearchId
        ? await getSavedSearchById(c.env.DB, savedSearchId, access.lineAccountId)
        : null;
      if (savedSearchId && (!row || !canReadSavedSearch(row, access))) {
        return c.json({ success: false, error: '保存した検索が見つかりません' }, 404);
      }
      const currentRevision = row ? Number(row.revision ?? 1) : 0;
      if (body.revision !== undefined
        && (!Number.isInteger(Number(body.revision)) || Number(body.revision) < 1)) {
        return c.json({ success: false, error: '確認する版が正しくありません' }, 400);
      }
      if (row && body.revision !== undefined && Number(body.revision) !== currentRevision) {
        return c.json({
          success: false,
          code: 'SAVED_SEARCH_REVISION_CONFLICT',
          error: 'ほかの担当者が先に変更しました。最新の内容を読み直してください',
          data: { currentRevision },
        }, 409);
      }
      let rawConditions = body.conditions;
      if (rawConditions === undefined && row) {
        try {
          rawConditions = JSON.parse(row.conditions_json);
        } catch {
          return c.json({ success: false, error: '保存した検索の条件が壊れています' }, 422);
        }
      }
      const conditions = validateSearchConditions(rawConditions);
      if (!conditions.ok) return c.json({ success: false, error: conditions.error }, 422);
      const [match, references, callCounts, referenceCallCounts] = await Promise.all([
        getSavedSearchMatchPreview(c.env.DB, conditions.value, access.lineAccountId),
        row ? getSavedSearchReferences(c.env.DB, [row.id], access.lineAccountId) : Promise.resolve([]),
        row ? getSavedSearchUsageCounts(c.env.DB, [row.id], access.lineAccountId) : Promise.resolve(new Map<string, number>()),
        row ? getSavedSearchReferenceUsageCounts(c.env.DB, [row.id], access.lineAccountId) : Promise.resolve(new Map<string, number>()),
      ]);
      if (row) {
        return c.json({
          success: true,
          data: {
            ...savedSearchDetail(
              { ...row, conditions_json: JSON.stringify(conditions.value) },
              match,
              references,
              callCounts.get(row.id) ?? 0,
              referenceCallCounts,
              access,
            ),
            conditions: conditions.value,
          },
        });
      }
      return c.json({
        success: true,
        data: {
          savedSearchId: null,
          conditions: conditions.value,
          revision: 0,
          scope: 'friends',
          accountScope: { type: 'line_account', id: access.lineAccountId },
          owner: { id: access.staffId, isCurrentUser: true },
          match,
          usedIn: [],
          canDelete: false,
          callCountThisMonth: 0,
        },
      });
    } catch (err) {
      console.error('POST /api/saved-searches/preview error:', err);
      return c.json({ success: false, error: '該当人数を確認できませんでした' }, 500);
    }
  },
);

friendAttributes.post('/api/saved-searches', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const staff = c.get('staff');
    const body = await c.req.json<Record<string, unknown>>();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return c.json({ success: false, error: '名前を入力してください' }, 400);
    const format = requestedConditionFormat(c);
    if (format instanceof Response) return format;

    // 上限を先に見る。条件の検証を通してから弾くと、書いた条件が無駄になる。
    const access = await savedSearchAccess(c);
    if (access instanceof Response) return access;
    const count = await countSavedSearches(c.env.DB, {
      scope: 'friends',
      conditionFormat: format,
      createdBy: staff.id,
      lineAccountId: access.lineAccountId,
    });
    if (count >= SAVED_SEARCH_LIMIT) {
      return c.json(
        {
          success: false,
          error: `保存できる検索は ${SAVED_SEARCH_LIMIT} 件までです。使っていないものを削除してください。`,
        },
        422,
      );
    }

    const conditions = validateConditionsForFormat(format, body.conditions);
    if (!conditions.ok) return c.json({ success: false, error: conditions.error }, 422);

    if (body.scope !== undefined && body.scope !== 'friends') {
      return c.json({ success: false, error: '保存した条件の種類が一致しません' }, 400);
    }
    if (body.isShared === true && staff.role === 'staff') {
      return c.json({ success: false, error: '共有の検索を作る権限がありません' }, 403);
    }

    const saved = await createSavedSearch(c.env.DB, {
      name,
      scope: 'friends',
      conditionFormat: format,
      conditions: conditions.value,
      createdBy: staff.id,
      lineAccountId: access.lineAccountId,
      isShared: body.isShared === true,
      displayOrder: Number(body.displayOrder ?? 0),
    });
    const insights = format === 'search_v1'
      ? await getSavedSearchMatchInsights(c.env.DB, [saved], access.lineAccountId)
      : new Map<string, SavedSearchMatchInsight>();
    return c.json({
      success: true,
      data: serializeSearch(saved, insights.get(saved.id), []),
    }, 201);
  } catch (err) {
    console.error('POST /api/saved-searches error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friendAttributes.patch(
  '/api/saved-searches/:id',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    try {
      const id = c.req.param('id');
      const format = requestedConditionFormat(c);
      if (format instanceof Response) return format;
      const access = await savedSearchAccess(c);
      if (access instanceof Response) return access;
      const existing = await getSavedSearchById(c.env.DB, id, access.lineAccountId);
      if (!existing || existing.scope !== 'friends'
          || (existing.condition_format ?? 'search_v1') !== format
          || existing.line_account_id !== access.lineAccountId
          || (existing.created_by !== access.staffId && !access.canManageAll)) {
        return c.json({ success: false, error: '保存した検索が見つかりません' }, 404);
      }

      const body = await c.req.json<Record<string, unknown>>();
      const expectedRevision = Number(
        body.expectedRevision ?? body.revision ?? existing.revision ?? 1,
      );
      if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
        return c.json({ success: false, error: '最新の版を指定してください' }, 400);
      }
      const patch: Parameters<typeof updateSavedSearchWithRevision>[4] = {};
      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name) return c.json({ success: false, error: '名前を入力してください' }, 400);
        patch.name = name;
      }
      if (body.conditions !== undefined) {
        const conditions = validateConditionsForFormat(format, body.conditions);
        if (!conditions.ok) return c.json({ success: false, error: conditions.error }, 422);
        patch.conditions = conditions.value;
      }
      if (body.isShared !== undefined) {
        if (!access.canManageAll) {
          return c.json({ success: false, error: '共有設定を変える権限がありません' }, 403);
        }
        patch.isShared = body.isShared === true;
      }
      if (body.displayOrder !== undefined) patch.displayOrder = Number(body.displayOrder);

      const update = await updateSavedSearchWithRevision(
        c.env.DB,
        id,
        access,
        expectedRevision,
        patch,
      );
      if (update.status === 'not_found') {
        return c.json({ success: false, error: '保存した検索が見つかりません' }, 404);
      }
      if (update.status === 'conflict') {
        const references = await getSavedSearchReferences(
          c.env.DB,
          [update.current.id],
          access.lineAccountId,
        );
        return c.json({
          success: false,
          code: 'SAVED_SEARCH_REVISION_CONFLICT',
          error: 'ほかの担当者が先に変更しました。最新の内容を読み直してください',
          data: {
            currentRevision: Number(update.current.revision ?? 1),
            usedIn: serializeSearch(update.current, undefined, references).usedIn,
          },
        }, 409);
      }
      const saved = update.search;
      const [insights, references, callCounts, referenceCallCounts] = await Promise.all([
        format === 'search_v1'
          ? getSavedSearchMatchInsights(c.env.DB, [saved], access.lineAccountId)
          : Promise.resolve(new Map<string, SavedSearchMatchInsight>()),
        getSavedSearchReferences(c.env.DB, [saved.id], access.lineAccountId),
        getSavedSearchUsageCounts(c.env.DB, [saved.id], access.lineAccountId),
        getSavedSearchReferenceUsageCounts(c.env.DB, [saved.id], access.lineAccountId),
      ]);
      return c.json({
        success: true,
        data: serializeSearch(
          saved,
          insights.get(saved.id),
          references,
          callCounts.get(saved.id) ?? 0,
          referenceCallCounts,
        ),
      });
    } catch (err) {
      console.error('PATCH /api/saved-searches/:id error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

friendAttributes.delete(
  '/api/saved-searches/:id',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    try {
      const format = requestedConditionFormat(c);
      if (format instanceof Response) return format;
      const access = await savedSearchAccess(c);
      if (access instanceof Response) return access;
      const id = c.req.param('id');
      const existing = await getSavedSearchById(c.env.DB, id, access.lineAccountId);
      if (!existing || existing.scope !== 'friends'
          || (existing.condition_format ?? 'search_v1') !== format
          || existing.line_account_id !== access.lineAccountId
          || (existing.created_by !== access.staffId && !access.canManageAll)) {
        return c.json({ success: false, error: '保存した検索が見つかりません' }, 404);
      }
      const references = await getSavedSearchReferences(c.env.DB, [id], access.lineAccountId);
      if (references.length > 0) {
        return c.json({
          success: false,
          error: `この検索は${references.length}件で使用中です。使用先を外してから削除してください。`,
          data: { usedIn: serializeSearch(existing, undefined, references).usedIn },
        }, 409);
      }
      const deleted = await deleteSavedSearch(c.env.DB, id, access);
      if (!deleted) return c.json({ success: false, error: '保存した検索が見つかりません' }, 404);
      return c.json({ success: true, data: null });
    } catch (err) {
      if (err instanceof Error && /foreign key constraint/i.test(err.message)) {
        return c.json({ success: false, error: 'この検索は使用中のため削除できません' }, 409);
      }
      console.error('DELETE /api/saved-searches/:id error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

// ── ログイン履歴 ────────────────────────────────────────────
//
// 誰がいつ入ったか、誰が個人情報を開いたか。個人情報保護法上の利用記録
// として残す必要がある。
//
// オーナーと管理者だけが見られる。誰がいつ入ったかは、それ自体が
// 見せてよい情報とは限らない。
friendAttributes.get('/api/login-audit', requireRole('owner', 'admin'), async (c) => {
  try {
    const rawAction = c.req.query('action');
    const action = (LOGIN_AUDIT_ACTIONS as readonly string[]).includes(rawAction ?? '')
      ? (rawAction as LoginAuditAction)
      : undefined;
    const items = await getLoginAudit(c.env.DB, {
      adminUserId: c.req.query('userId') || undefined,
      action,
      limit: Number(c.req.query('limit') ?? 100),
    });
    const tenantId = c.get('staff').tenantId ?? DEFAULT_TENANT_ID;
    const staffById = new Map((await getStaffMembers(c.env.DB, tenantId)).map((member) => [member.id, member]));
    return c.json({
      success: true,
      data: items.map((row: LoginAuditRow) => ({
        id: row.id,
        adminUserId: row.admin_user_id,
        userName: row.admin_user_id ? staffById.get(row.admin_user_id)?.name ?? '不明なユーザー' : '不明なユーザー',
        role: row.admin_user_id
          ? (staffById.get(row.admin_user_id)?.access_level === 'read_only'
              ? 'viewer'
              : staffById.get(row.admin_user_id)?.role === 'staff' ? 'staff' : 'admin')
          : null,
        lineLinked: row.admin_user_id ? Boolean(staffById.get(row.admin_user_id)?.line_user_id) : false,
        isActive: row.admin_user_id ? Boolean(staffById.get(row.admin_user_id)?.is_active) : false,
        action: row.action,
        screen: row.screen,
        // IPは残すが、一覧では末尾を伏せる。監査に必要なのは
        // 「いつもと違うところから入っていないか」で、完全な値は要らない。
        ip: row.ip ? maskIp(row.ip) : null,
        connectionSource: [row.ip ? maskIp(row.ip) : null, row.user_agent ? row.user_agent.slice(0, 42) : null].filter(Boolean).join(' / ') || null,
        result: row.result,
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/login-audit error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ── 汎用フォルダ ────────────────────────────────────────────

friendAttributes.get('/api/folders', async (c) => {
  try {
    const raw = c.req.query('kind');
    if (raw && !isFolderKind(raw)) {
      return c.json({ success: false, error: '知らないフォルダの種類です' }, 400);
    }
    if (raw !== 'webinar') {
      const items = await getFolders(c.env.DB, raw && isFolderKind(raw) ? raw : undefined);
      return c.json({ success: true, data: items.map((row) => serializeFolder(row)) });
    }
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const requestedAccountId = c.req.query('account_id')?.trim();
    if (!requestedAccountId) {
      return c.json({ success: false, error: 'account_id_required' }, 400);
    }
    if (!scope.allowedAccountIds.includes(requestedAccountId)) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const items = await getFolders(c.env.DB, 'webinar', requestedAccountId);
    const counts = await getWebinarFolderCounts(c.env.DB, {
      allowedAccountIds: scope.allowedAccountIds,
      canSeeUnassigned: scope.canSeeUnassigned,
      accountId: requestedAccountId,
    });
    return c.json({
      success: true,
      data: items.map((row) => serializeFolder(row, counts[row.id] ?? 0)),
    });
  } catch (err) {
    console.error('GET /api/folders error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friendAttributes.post('/api/folders', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>();
    if (!isFolderKind(body.kind)) {
      return c.json({ success: false, error: '知らないフォルダの種類です' }, 400);
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return c.json({ success: false, error: 'フォルダ名を入力してください' }, 400);

    const accountId = body.kind === 'webinar'
      ? (typeof body.accountId === 'string' ? body.accountId.trim() : '')
      : '';
    if (body.kind === 'webinar') {
      if (!accountId) return c.json({ success: false, error: 'account_id_required' }, 400);
      const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
      if (!scope.allowedAccountIds.includes(accountId)) {
        return c.json({ success: false, error: 'Not found' }, 404);
      }
    }

    // 入れ子は1段まで。深くすると画面が組み立てられなくなる。
    if (body.parentId) {
      const parent = await getFolderById(c.env.DB, String(body.parentId));
      if (!parent) return c.json({ success: false, error: '親フォルダが見つかりません' }, 400);
      if (parent.parent_id) {
        return c.json({ success: false, error: 'フォルダは2段までです' }, 422);
      }
      if (parent.kind !== body.kind) {
        return c.json({ success: false, error: '別の種類のフォルダには入れられません' }, 422);
      }
      if (body.kind === 'webinar' && parent.account_id !== accountId) {
        return c.json({ success: false, error: '親フォルダが見つかりません' }, 400);
      }
    }

    // 色はフォルダに付く。既存の COLOR_PATTERN と同じ決まりで見る。
    let color: string | null = null;
    if (body.color !== undefined && body.color !== null && body.color !== '') {
      const raw = String(body.color);
      if (!COLOR_PATTERN.test(raw)) {
        return c.json({ success: false, error: '色は #RRGGBB の形で指定してください' }, 400);
      }
      color = raw;
    }

    const folder = await createFolder(c.env.DB, {
      kind: body.kind,
      name,
      parentId: body.parentId ? String(body.parentId) : null,
      displayOrder: Number(body.displayOrder ?? 0),
      color,
      accountId: accountId || null,
    });
    return c.json({ success: true, data: serializeFolder(folder) }, 201);
  } catch (err) {
    console.error('POST /api/folders error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friendAttributes.patch('/api/folders/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getFolderById(c.env.DB, id);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    const body = await c.req.json<Record<string, unknown>>();
    let webinarAccountId = '';
    if (existing.kind === 'webinar') {
      webinarAccountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
      if (!webinarAccountId) return c.json({ success: false, error: 'account_id_required' }, 400);
      const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
      if (!scope.allowedAccountIds.includes(webinarAccountId) || existing.account_id !== webinarAccountId) {
        return c.json({ success: false, error: 'Not found' }, 404);
      }
    }
    const patch: Parameters<typeof updateFolder>[2] = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return c.json({ success: false, error: 'フォルダ名を入力してください' }, 400);
      patch.name = name;
    }
    if ('parentId' in body) {
      const parentId = body.parentId ? String(body.parentId) : null;
      // 自分を自分の親にはできない。一覧の描画が無限に回る。
      if (parentId === id) {
        return c.json({ success: false, error: '自分自身を親にはできません' }, 422);
      }
      patch.parentId = parentId;
      if (parentId) {
        const parent = await getFolderById(c.env.DB, parentId);
        if (!parent || parent.kind !== existing.kind
          || (existing.kind === 'webinar' && parent.account_id !== webinarAccountId)) {
          return c.json({ success: false, error: '親フォルダが見つかりません' }, 400);
        }
        if (parent.parent_id) {
          return c.json({ success: false, error: 'フォルダは2段までです' }, 422);
        }
      }
    }
    if (body.displayOrder !== undefined) patch.displayOrder = Number(body.displayOrder);
    if ('color' in body) {
      const raw = body.color;
      if (raw === null || raw === '') {
        patch.color = null;
      } else {
        const value = String(raw);
        if (!COLOR_PATTERN.test(value)) {
          return c.json({ success: false, error: '色は #RRGGBB の形で指定してください' }, 400);
        }
        patch.color = value;
      }
    }

    const folder = await updateFolder(c.env.DB, id, patch);
    return c.json({ success: true, data: serializeFolder(folder!) });
  } catch (err) {
    console.error('PATCH /api/folders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 中身は消えず「未分類」に戻る。ただし子フォルダは一緒に消える。
friendAttributes.delete('/api/folders/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getFolderById(c.env.DB, id);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    if (existing.kind === 'webinar') {
      const accountId = c.req.query('account_id')?.trim();
      if (!accountId) return c.json({ success: false, error: 'account_id_required' }, 400);
      const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
      if (!scope.allowedAccountIds.includes(accountId) || existing.account_id !== accountId) {
        return c.json({ success: false, error: 'Not found' }, 404);
      }
    }
    await deleteFolder(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/folders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { friendAttributes };
