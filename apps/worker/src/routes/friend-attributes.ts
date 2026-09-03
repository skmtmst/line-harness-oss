import { Hono, type Context } from 'hono';
import {
  getSupportMarksWithUsage,
  getSupportMarkById,
  createSupportMark,
  updateSupportMark,
  replaceAndArchiveSupportMark,
  getDefaultSupportMark,
  setFriendSupportMark,
  setFriendSupportMarkBulk,
  getSavedSearches,
  getSavedSearchById,
  createSavedSearch,
  updateSavedSearch,
  deleteSavedSearch,
  countSavedSearches,
  getSavedSearchReferences,
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
  type SavedSearchMatchInsight,
} from '../services/saved-search-insights.js';
import {
  archiveSupportMarkAutomationRule,
  createSupportMarkAutomationRule,
  listSupportMarkAutomationRules,
  SUPPORT_MARK_RULE_EVENTS,
  updateSupportMarkAutomationRule,
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

function serializeMark(row: SupportMark) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    isDefault: Boolean(row.is_default),
    autoOnInbound: Boolean(row.auto_on_inbound),
    displayOrder: row.display_order,
    createdAt: row.created_at,
    isInherited: Boolean(row.is_inherited),
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
    matchCount: insight.matchCount,
    matchCountError: insight.matchCountError,
    usedIn: references.map((reference) => ({
      kind: reference.reference_kind,
      id: reference.reference_id,
      name: reference.reference_name,
      mode: reference.reference_mode,
      lastUsedAt: reference.last_used_at,
    })),
    canDelete: references.length === 0,
  };
}

async function savedSearchAccess(c: Context<Env>): Promise<SavedSearchAccess | Response> {
  const lineAccountId = c.req.query('lineAccountId');
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

function serializeFolder(row: Folder) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    parentId: row.parent_id,
    displayOrder: row.display_order,
    color: row.color ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
    const marks = await getSupportMarksWithUsage(c.env.DB, scope);
    const withCounts = marks.map((mark) => ({
        ...serializeMark(mark),
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
    const mark = await createSupportMark(c.env.DB, scope, {
      name,
      color: body.color ? String(body.color) : undefined,
      isDefault: body.isDefault === true,
      autoOnInbound: body.autoOnInbound === true,
      displayOrder: Number(body.displayOrder ?? 0),
    });
    return c.json({ success: true, data: serializeMark(mark) }, 201);
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
    const access = await savedSearchAccess(c);
    if (access instanceof Response) return access;
    const items = await getSavedSearches(c.env.DB, 'friends', access, format);
    const visible = items.filter((row) =>
      row.scope === 'friends' && (row.condition_format ?? 'search_v1') === format
      && (row.line_account_id === access.lineAccountId
        ? access.canManageAll || Boolean(row.is_shared) || row.created_by === access.staffId
        : row.line_account_id === null && row.created_by === access.staffId));
    const [insights, references] = await Promise.all([
      format === 'search_v1'
        ? getSavedSearchMatchInsights(c.env.DB, visible, access.lineAccountId)
        : Promise.resolve(new Map<string, SavedSearchMatchInsight>()),
      getSavedSearchReferences(c.env.DB, visible.map((row) => row.id), access.lineAccountId),
    ]);
    const referencesBySearch = new Map<string, SavedSearchReference[]>();
    for (const reference of references) {
      const current = referencesBySearch.get(reference.saved_search_id) ?? [];
      current.push(reference);
      referencesBySearch.set(reference.saved_search_id, current);
    }
    return c.json({
      success: true,
      data: visible.map((row) => serializeSearch(
        row,
        insights.get(row.id),
        referencesBySearch.get(row.id),
      )),
    });
  } catch (err) {
    console.error('GET /api/saved-searches error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

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
      const patch: Parameters<typeof updateSavedSearch>[3] = {};
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

      const saved = await updateSavedSearch(c.env.DB, id, access, patch);
      if (!saved) return c.json({ success: false, error: '保存した検索が見つかりません' }, 404);
      const [insights, references] = await Promise.all([
        format === 'search_v1'
          ? getSavedSearchMatchInsights(c.env.DB, [saved], access.lineAccountId)
          : Promise.resolve(new Map<string, SavedSearchMatchInsight>()),
        getSavedSearchReferences(c.env.DB, [saved.id], access.lineAccountId),
      ]);
      return c.json({
        success: true,
        data: serializeSearch(saved, insights.get(saved.id), references),
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
    const items = await getFolders(c.env.DB, raw && isFolderKind(raw) ? raw : undefined);
    return c.json({ success: true, data: items.map(serializeFolder) });
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
    await deleteFolder(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/folders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { friendAttributes };
