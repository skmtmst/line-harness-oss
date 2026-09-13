import { Hono, type Context } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type {
  MergedPersonDeliveryPriorityInput,
  MergedPersonProfileSelectionInput,
  MergedPersonStatus,
  UpdateMergedPersonDeliveryPrioritiesRequest,
  UpdateMergedPersonRequest,
} from '@line-crm/shared';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';
import {
  getFriendProfileCandidates,
  resolveProfileCandidateSelections,
  type ProfileCandidateSelectionReference,
} from '../services/friend-profile-candidates.js';
import {
  getMergedPerson,
  listMergedPeople,
  mergedPersonAccountIds,
  MergedPersonError,
  unlinkMergedPersonFriend,
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
  if (value.profileSelections !== undefined) {
    throw new MergedPersonError(
      422,
      'PROFILE_CANDIDATE_REQUIRED',
      'プロフィールの採用値は候補を選ぶ専用の操作から変更してください',
    );
  }
  return {
    expectedRevision: Number(value.expectedRevision),
    ...(typeof value.primaryDisplayName === 'string'
      ? { primaryDisplayName: value.primaryDisplayName }
      : {}),
    ...(status ? { status } : {}),
  };
}

function parseProfileCandidateBody(value: unknown): {
  expectedRevision: number;
  selections: ProfileCandidateSelectionReference[];
} {
  if (!isRecord(value)
    || !Number.isInteger(value.expectedRevision)
    || Number(value.expectedRevision) < 1
    || !Array.isArray(value.selections)) {
    throw new MergedPersonError(422, 'INVALID_BODY', '読み込んだ版とプロフィール候補を確認してください');
  }
  const fields = new Set<string>();
  const selections = value.selections.map((raw) => {
    if (!isRecord(raw)
      || typeof raw.fieldKey !== 'string'
      || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(raw.fieldKey)
      || typeof raw.candidateId !== 'string'
      || !/^pc_[0-9a-f]{64}$/.test(raw.candidateId)
      || !['auto', 'fixed'].includes(String(raw.updateMode))) {
      throw new MergedPersonError(422, 'INVALID_PROFILE_CANDIDATE', '採用するプロフィール候補を確認できません');
    }
    if (fields.has(raw.fieldKey)) {
      throw new MergedPersonError(422, 'PROFILE_SELECTION_DUPLICATE', '同じプロフィール項目を複数回選べません');
    }
    fields.add(raw.fieldKey);
    return {
      fieldKey: raw.fieldKey,
      candidateId: raw.candidateId,
      updateMode: raw.updateMode as ProfileCandidateSelectionReference['updateMode'],
    };
  });
  if (selections.length === 0 || selections.length > 100) {
    throw new MergedPersonError(422, 'PROFILE_SELECTIONS_REQUIRED', '採用するプロフィール候補を1件以上選んでください');
  }
  return { expectedRevision: Number(value.expectedRevision), selections };
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

function positiveInt(value: string | undefined, fallback: number, max: number): number | null {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : null;
}

mergedPeople.get('/api/friends/people', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const limit = positiveInt(c.req.query('limit'), 20, 100);
    const offset = positiveInt(c.req.query('offset'), 0, 100_000);
    if (limit === null || limit < 1 || offset === null) {
      return c.json({ success: false, error: 'ページ位置が正しくありません', code: 'INVALID_PAGINATION' }, 400);
    }
    const scope = await getVisibleLineAccountScope(c.env.DB, getStaff(c));
    const data = await listMergedPeople(c.env.DB, tenantId(c), scope.allowedAccountIds, limit, offset);
    return c.json({ success: true, data });
  } catch (error) {
    return errorResponse(c, error);
  }
});

mergedPeople.get('/api/friends/people/:id', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    if (!await canAccessPerson(c, c.req.param('id'))) {
      return c.json({ success: false, error: 'この統合ユーザーを表示する権限がありません', code: 'FORBIDDEN' }, 403);
    }
    const data = await getMergedPerson(c.env.DB, tenantId(c), c.req.param('id'));
    const candidates = await getFriendProfileCandidates(
      c.env.DB,
      data.linkedFriends.map((friend) => friend.friendId),
    );
    return c.json({ success: true, data: { ...data, ...candidates } });
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

mergedPeople.patch('/api/friends/people/:id/profile-values', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    if (!await canAccessPerson(c, id)) {
      return c.json({ success: false, error: 'この統合ユーザーを変更する権限がありません', code: 'FORBIDDEN' }, 403);
    }
    const request = parseProfileCandidateBody(await safeBody(c));
    const before = await getMergedPerson(c.env.DB, tenantId(c), id);
    let selections: MergedPersonProfileSelectionInput[];
    try {
      selections = await resolveProfileCandidateSelections(
        c.env.DB,
        before.linkedFriends.map((friend) => friend.friendId),
        request.selections,
      );
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'PROFILE_SELECTION_DUPLICATE') {
        throw new MergedPersonError(422, code, '同じプロフィール項目を複数回選べません');
      }
      throw new MergedPersonError(
        409,
        'STALE_PROFILE_CANDIDATE',
        '候補の値が変わりました。最新の状態を読み直してください',
      );
    }
    const staff = getStaff(c)!;
    const data = await updateMergedPerson(
      c.env.DB,
      { id: staff.id, name: staff.name, tenantId: tenantId(c) },
      id,
      { expectedRevision: request.expectedRevision, profileSelections: selections },
    );
    const candidates = await getFriendProfileCandidates(
      c.env.DB,
      data.linkedFriends.map((friend) => friend.friendId),
    );
    return c.json({ success: true, data: { ...data, ...candidates } });
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

mergedPeople.delete(
  '/api/friends/people/:id/links/:friendId',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      if (!await canAccessPerson(c, c.req.param('id'))) {
        return c.json({ success: false, error: 'この結び付けを解除する権限がありません', code: 'FORBIDDEN' }, 403);
      }
      const raw = await safeBody(c);
      if (!isRecord(raw)
          || !Number.isInteger(raw.expectedRevision)
          || Number(raw.expectedRevision) < 1
          || typeof raw.reason !== 'string') {
        throw new MergedPersonError(422, 'INVALID_BODY', '読み込んだ版と解除理由を確認してください');
      }
      const staff = getStaff(c)!;
      const data = await unlinkMergedPersonFriend(
        c.env.DB,
        { id: staff.id, name: staff.name, tenantId: tenantId(c) },
        c.req.param('id'),
        c.req.param('friendId'),
        { expectedRevision: Number(raw.expectedRevision), reason: raw.reason },
      );
      return c.json({ success: true, data });
    } catch (error) {
      return errorResponse(c, error);
    }
  },
);
