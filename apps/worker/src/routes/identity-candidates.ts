import { Hono, type Context } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type {
  DecideIdentityCandidateRequest,
  IdentityCandidateKind,
  IdentityCandidateStatus,
  UndoIdentityCandidateRequest,
} from '@line-crm/shared';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import {
  candidateAccountIds,
  decideIdentityCandidate,
  getIdentityCandidate,
  IdentityCandidateError,
  listIdentityCandidates,
  undoIdentityCandidate,
} from '../services/identity-candidates.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';

const KINDS = new Set<IdentityCandidateKind>(['friend_duplicate', 'ec_member']);
const STATUSES = new Set<IdentityCandidateStatus>([
  'pending', 'linked', 'different', 'deferred', 'invalidated',
]);

export const identityCandidates = new Hono<Env>();

function tenantId(c: Parameters<typeof getStaff>[0]): string {
  return getStaff(c)?.tenantId ?? DEFAULT_TENANT_ID;
}

function getStaff(c: { get(name: 'staff'): Env['Variables']['staff'] }) {
  return c.get('staff');
}

function canUseKind(c: Parameters<typeof getStaff>[0], kind: IdentityCandidateKind): boolean {
  const staff = getStaff(c);
  if (!staff || staff.role === 'owner' || staff.role === 'admin') return Boolean(staff);
  const permission = kind === 'friend_duplicate' ? '/friends' : '/ec-commerce';
  return staff.permissionKeys?.includes(permission) ?? false;
}

function positiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= 0 ? Math.min(parsed, max) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDecisionBody(value: unknown): DecideIdentityCandidateRequest {
  if (!isRecord(value)) {
    throw new IdentityCandidateError(422, 'INVALID_BODY', '判定内容を確認できません');
  }
  if (!Number.isInteger(value.expectedVersion) || Number(value.expectedVersion) < 1) {
    throw new IdentityCandidateError(422, 'EXPECTED_VERSION_REQUIRED', '読み込んだ版を指定してください');
  }
  if (value.decision !== 'linked' && value.decision !== 'different' && value.decision !== 'deferred') {
    throw new IdentityCandidateError(422, 'INVALID_DECISION', '判定の種類が正しくありません');
  }
  if (typeof value.reason !== 'string') {
    throw new IdentityCandidateError(422, 'REASON_REQUIRED', '判定の理由を入力してください');
  }
  let reprocess: DecideIdentityCandidateRequest['reprocess'];
  if (value.reprocess !== undefined) {
    if (!isRecord(value.reprocess) || typeof value.reprocess.mode !== 'string') {
      throw new IdentityCandidateError(422, 'INVALID_REPROCESS', '再処理の範囲が正しくありません');
    }
    reprocess = {
      mode: value.reprocess.mode as DecideIdentityCandidateRequest['reprocess'] extends { mode: infer T } ? T : never,
      from: typeof value.reprocess.from === 'string' ? value.reprocess.from : null,
      to: typeof value.reprocess.to === 'string' ? value.reprocess.to : null,
    };
  }
  return {
    expectedVersion: Number(value.expectedVersion),
    decision: value.decision,
    reason: value.reason,
    ...(reprocess ? { reprocess } : {}),
  };
}

function parseUndoBody(value: unknown): UndoIdentityCandidateRequest {
  if (!isRecord(value) || !Number.isInteger(value.expectedVersion) || typeof value.reason !== 'string') {
    throw new IdentityCandidateError(422, 'INVALID_BODY', '取り消す版と理由を確認できません');
  }
  return { expectedVersion: Number(value.expectedVersion), reason: value.reason };
}

async function safeBody(c: { req: { json<T>(): Promise<T> } }): Promise<unknown> {
  try {
    return await c.req.json<unknown>();
  } catch {
    throw new IdentityCandidateError(422, 'INVALID_JSON', '送信内容を読み取れません');
  }
}

function errorResponse(c: Context<Env>, error: unknown): Response {
  if (error instanceof IdentityCandidateError) {
    return c.json({ success: false, error: error.message, code: error.code }, error.status);
  }
  console.error('identity candidates error:', error);
  return c.json(
    { success: false, error: '本人照合の記録を処理できませんでした', code: 'INTERNAL_ERROR' },
    500,
  );
}

identityCandidates.get('/api/identity-candidates', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const kind = c.req.query('kind') as IdentityCandidateKind | undefined;
    const status = (c.req.query('status') ?? 'pending') as IdentityCandidateStatus;
    if (!kind || !KINDS.has(kind)) {
      return c.json({ success: false, error: '候補の種類を指定してください', code: 'KIND_REQUIRED' }, 400);
    }
    if (!STATUSES.has(status)) {
      return c.json({ success: false, error: '候補の状態が正しくありません', code: 'INVALID_STATUS' }, 400);
    }
    if (!canUseKind(c, kind)) {
      return c.json({ success: false, error: 'この候補を表示する権限がありません', code: 'FORBIDDEN' }, 403);
    }
    const scope = await getVisibleLineAccountScope(c.env.DB, getStaff(c));
    const data = await listIdentityCandidates(c.env.DB, {
      tenantId: tenantId(c), kind, status, allowedAccountIds: scope.allowedAccountIds,
      limit: Math.max(1, positiveInt(c.req.query('limit'), 20, 100)),
      offset: positiveInt(c.req.query('offset'), 0, 100_000),
    });
    return c.json({ success: true, data });
  } catch (error) {
    return errorResponse(c, error);
  }
});

identityCandidates.get('/api/identity-candidates/:id', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const data = await getIdentityCandidate(c.env.DB, tenantId(c), c.req.param('id'));
    if (!canUseKind(c, data.kind)) {
      return c.json({ success: false, error: 'この候補を表示する権限がありません', code: 'FORBIDDEN' }, 403);
    }
    const accountIds = await candidateAccountIds(c.env.DB, tenantId(c), data.id);
    if (!await canAccessAllLineAccounts(c.env.DB, getStaff(c), accountIds)) {
      return c.json({ success: false, error: 'この候補を表示する権限がありません', code: 'FORBIDDEN' }, 403);
    }
    return c.json({ success: true, data });
  } catch (error) {
    return errorResponse(c, error);
  }
});

identityCandidates.post('/api/identity-candidates/:id/decide', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const current = await getIdentityCandidate(c.env.DB, tenantId(c), c.req.param('id'));
    if (!canUseKind(c, current.kind)) {
      return c.json({ success: false, error: 'この候補を判定する権限がありません', code: 'FORBIDDEN' }, 403);
    }
    const accountIds = await candidateAccountIds(c.env.DB, tenantId(c), current.id);
    if (!await canAccessAllLineAccounts(c.env.DB, getStaff(c), accountIds)) {
      return c.json({ success: false, error: 'この候補を判定する権限がありません', code: 'FORBIDDEN' }, 403);
    }
    const staff = getStaff(c)!;
    const data = await decideIdentityCandidate(
      c.env.DB,
      { id: staff.id, name: staff.name, tenantId: tenantId(c) },
      current.id,
      parseDecisionBody(await safeBody(c)),
    );
    return c.json({ success: true, data });
  } catch (error) {
    return errorResponse(c, error);
  }
});

identityCandidates.post('/api/identity-candidates/:id/undo', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const current = await getIdentityCandidate(c.env.DB, tenantId(c), c.req.param('id'));
    if (!canUseKind(c, current.kind)) {
      return c.json({ success: false, error: 'この判定を取り消す権限がありません', code: 'FORBIDDEN' }, 403);
    }
    const accountIds = await candidateAccountIds(c.env.DB, tenantId(c), current.id);
    if (!await canAccessAllLineAccounts(c.env.DB, getStaff(c), accountIds)) {
      return c.json({ success: false, error: 'この判定を取り消す権限がありません', code: 'FORBIDDEN' }, 403);
    }
    const staff = getStaff(c)!;
    const data = await undoIdentityCandidate(
      c.env.DB,
      { id: staff.id, name: staff.name, tenantId: tenantId(c) },
      current.id,
      parseUndoBody(await safeBody(c)),
    );
    return c.json({ success: true, data });
  } catch (error) {
    return errorResponse(c, error);
  }
});
