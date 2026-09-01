import { Hono, type Context } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type {
  MergedPersonDeliveryPriorityInput,
  MergedPersonJsonValue,
  MergedPersonProfileSelectionInput,
  MergedPersonStatus,
  UpdateMergedPersonDeliveryPrioritiesRequest,
  UpdateMergedPersonRequest,
} from '@line-crm/shared';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import {
  getMergedPerson,
  mergedPersonAccountIds,
  MergedPersonError,
  updateMergedPerson,
  updateMergedPersonDeliveryPriorities,
} from '../services/merged-people.js';

export const mergedPeople = new Hono<Env>();

function getStaff(c: { get(name: 'staff'): Env['Variables']['staff'] }) {
  return c.get('staff');
}

function tenantId(c: Parameters<typeof getStaff>[0]): string {
  return getStaff(c)?.tenantId ?? DEFAULT_TENANT_ID;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown, depth = 0): value is MergedPersonJsonValue {
  if (depth > 8) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([key, item]) => key.length <= 100 && isJsonValue(item, depth + 1));
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new MergedPersonError(422, 'INVALID_BODY', `${label}を確認できません`);
  }
  return value;
}

function parseProfileSelection(value: unknown): MergedPersonProfileSelectionInput {
  if (!isRecord(value)
    || typeof value.fieldKey !== 'string'
    || typeof value.fieldLabel !== 'string'
    || !isJsonValue(value.value)
    || (value.valuePreview !== null && typeof value.valuePreview !== 'string')
    || !['friend', 'friend_field', 'form', 'ec', 'manual'].includes(String(value.sourceType))
    || typeof value.sourceLabel !== 'string'
    || (value.sourceFriendId !== null && typeof value.sourceFriendId !== 'string')
    || (value.verifiedAt !== null && typeof value.verifiedAt !== 'string')
    || !['auto', 'fixed'].includes(String(value.updateMode))) {
    throw new MergedPersonError(422, 'INVALID_PROFILE_SELECTION', 'プロフィールの採用値を確認できません');
  }
  return {
    fieldKey: value.fieldKey,
    fieldLabel: value.fieldLabel,
    value: value.value,
    valuePreview: value.valuePreview,
    sourceType: value.sourceType as MergedPersonProfileSelectionInput['sourceType'],
    sourceId: nullableString(value.sourceId, '取得元ID'),
    sourceLabel: value.sourceLabel,
    sourceFriendId: value.sourceFriendId,
    verifiedAt: value.verifiedAt,
    updateMode: value.updateMode as MergedPersonProfileSelectionInput['updateMode'],
  };
}

function parseUpdateBody(value: unknown): UpdateMergedPersonRequest {
  if (!isRecord(value) || !Number.isInteger(value.expectedRevision) || Number(value.expectedRevision) < 1) {
    throw new MergedPersonError(422, 'EXPECTED_REVISION_REQUIRED', '読み込んだ版を指定してください');
  }
  const status = value.status as MergedPersonStatus | undefined;
  if (status !== undefined && !['active', 'review', 'archived'].includes(status)) {
    throw new MergedPersonError(422, 'INVALID_PERSON_STATUS', '統合ユーザーの状態が正しくありません');
  }
  if (value.primaryDisplayName !== undefined && typeof value.primaryDisplayName !== 'string') {
    throw new MergedPersonError(422, 'INVALID_DISPLAY_NAME', '表示名を確認できません');
  }
  if (value.profileSelections !== undefined && !Array.isArray(value.profileSelections)) {
    throw new MergedPersonError(422, 'INVALID_PROFILE_SELECTIONS', 'プロフィールの採用値を確認できません');
  }
  return {
    expectedRevision: Number(value.expectedRevision),
    ...(typeof value.primaryDisplayName === 'string'
      ? { primaryDisplayName: value.primaryDisplayName }
      : {}),
    ...(status ? { status } : {}),
    ...(Array.isArray(value.profileSelections)
      ? { profileSelections: value.profileSelections.map(parseProfileSelection) }
      : {}),
  };
}

function parsePriority(value: unknown): MergedPersonDeliveryPriorityInput {
  if (!isRecord(value)
    || !['broadcast', 'scenario', 'reminder', 'transactional', 'manual'].includes(String(value.purpose))
    || typeof value.friendId !== 'string'
    || !Number.isInteger(value.priority)
    || typeof value.isActive !== 'boolean'
    || typeof value.reason !== 'string') {
    throw new MergedPersonError(422, 'INVALID_DELIVERY_PRIORITY', '配信の優先順位を確認できません');
  }
  return {
    purpose: value.purpose as MergedPersonDeliveryPriorityInput['purpose'],
    friendId: value.friendId,
    priority: Number(value.priority),
    isActive: value.isActive,
    reason: value.reason,
  };
}

function parsePrioritiesBody(value: unknown): UpdateMergedPersonDeliveryPrioritiesRequest {
  if (!isRecord(value)
    || !Number.isInteger(value.expectedRevision)
    || Number(value.expectedRevision) < 1
    || !Array.isArray(value.priorities)) {
    throw new MergedPersonError(422, 'INVALID_BODY', '読み込んだ版と配信の優先順位を確認してください');
  }
  return {
    expectedRevision: Number(value.expectedRevision),
    priorities: value.priorities.map(parsePriority),
  };
}

async function safeBody(c: { req: { json<T>(): Promise<T> } }): Promise<unknown> {
  try {
    return await c.req.json<unknown>();
  } catch {
    throw new MergedPersonError(422, 'INVALID_JSON', '送信内容を読み取れません');
  }
}

function errorResponse(c: Context<Env>, error: unknown): Response {
  if (error instanceof MergedPersonError) {
    return c.json({ success: false, error: error.message, code: error.code }, error.status);
  }
  console.error(JSON.stringify({
    message: 'merged person request failed',
    error: error instanceof Error ? error.message : String(error),
  }));
  return c.json(
    { success: false, error: '統合ユーザーを処理できませんでした', code: 'INTERNAL_ERROR' },
    500,
  );
}

async function canAccessPerson(c: Context<Env>, id: string): Promise<boolean> {
  const accountIds = await mergedPersonAccountIds(c.env.DB, tenantId(c), id);
  return accountIds.length > 0
    && canAccessAllLineAccounts(c.env.DB, getStaff(c), accountIds);
}

mergedPeople.get('/api/friends/people/:id', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    if (!await canAccessPerson(c, c.req.param('id'))) {
      return c.json({ success: false, error: 'この統合ユーザーを表示する権限がありません', code: 'FORBIDDEN' }, 403);
    }
    const data = await getMergedPerson(c.env.DB, tenantId(c), c.req.param('id'));
    return c.json({ success: true, data });
  } catch (error) {
    return errorResponse(c, error);
  }
});

mergedPeople.patch('/api/friends/people/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    if (!await canAccessPerson(c, c.req.param('id'))) {
      return c.json({ success: false, error: 'この統合ユーザーを変更する権限がありません', code: 'FORBIDDEN' }, 403);
    }
    const staff = getStaff(c)!;
    const data = await updateMergedPerson(
      c.env.DB,
      { id: staff.id, name: staff.name, tenantId: tenantId(c) },
      c.req.param('id'),
      parseUpdateBody(await safeBody(c)),
    );
    return c.json({ success: true, data });
  } catch (error) {
    return errorResponse(c, error);
  }
});

mergedPeople.patch(
  '/api/friends/people/:id/delivery-priorities',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      if (!await canAccessPerson(c, c.req.param('id'))) {
        return c.json({ success: false, error: 'この統合ユーザーを変更する権限がありません', code: 'FORBIDDEN' }, 403);
      }
      const staff = getStaff(c)!;
      const data = await updateMergedPersonDeliveryPriorities(
        c.env.DB,
        { id: staff.id, name: staff.name, tenantId: tenantId(c) },
        c.req.param('id'),
        parsePrioritiesBody(await safeBody(c)),
      );
      return c.json({ success: true, data });
    } catch (error) {
      return errorResponse(c, error);
    }
  },
);
