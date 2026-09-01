import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const identityMocks = vi.hoisted(() => {
  class TestIdentityCandidateError extends Error {
    constructor(
      public readonly status: 400 | 403 | 404 | 409 | 422,
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    candidateAccountIds: vi.fn(),
    decideIdentityCandidate: vi.fn(),
    getIdentityCandidate: vi.fn(),
    listIdentityCandidates: vi.fn(),
    undoIdentityCandidate: vi.fn(),
    IdentityCandidateError: TestIdentityCandidateError,
  };
});

const accessMocks = vi.hoisted(() => ({
  canAccessAllLineAccounts: vi.fn(),
  getVisibleLineAccountScope: vi.fn(),
}));

const detectorMocks = vi.hoisted(() => ({
  detectFriendDuplicateCandidates: vi.fn(),
}));

vi.mock('../services/identity-candidates.js', () => identityMocks);
vi.mock('../services/account-access.js', () => accessMocks);
vi.mock('../services/friend-duplicate-candidates.js', () => detectorMocks);

const { identityCandidates } = await import('./identity-candidates.js');

const candidate = {
  id: 'candidate-a',
  kind: 'friend_duplicate' as const,
  status: 'pending' as const,
  version: 1,
  confidence: { score: 92, label: 'very_high' as const },
  left: {
    kind: 'friend' as const, id: 'friend-a', label: '\u7530\u4e2d \u82b1\u5b50', detail: '\u672c\u5e97',
    lineAccountId: 'account-a', lineAccountName: '\u672c\u5e97', shopKey: null,
    attributes: [{ label: '\u30e1\u30fc\u30eb', valuePreview: 'ta***@example.jp', verified: true }],
  },
  right: {
    kind: 'friend' as const, id: 'friend-b', label: '\u7530\u4e2d \u306f\u306a\u3053', detail: '\u652f\u5e97',
    lineAccountId: 'account-b', lineAccountName: '\u652f\u5e97', shopKey: null,
    attributes: [{ label: '\u30e1\u30fc\u30eb', valuePreview: 'ta***@example.jp', verified: true }],
  },
  evidence: [],
  impact: [],
  history: [],
  detectedAt: '2026-08-30T10:00:00.000Z',
  reviewedAt: null,
  canDecide: true,
  canUndo: false,
  undoNote: '\u5224\u5b9a\u3092\u53d6\u308a\u6d88\u305b\u307e\u3059',
};

function harness(options?: { role?: 'owner' | 'staff'; permissions?: string[] }) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.env = { DB: {} as D1Database } as Env['Bindings'];
    c.set('staff', {
      id: 'staff-a', name: '\u62c5\u5f53\u8005', role: options?.role ?? 'owner', readOnly: false,
      tenantId: 'tenant-a', permissionKeys: options?.permissions ?? [],
      assignedLineAccountId: null, canAccessDescendantAccounts: false,
    });
    await next();
  });
  app.route('/', identityCandidates);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  identityMocks.getIdentityCandidate.mockResolvedValue(candidate);
  identityMocks.candidateAccountIds.mockResolvedValue(['account-a', 'account-b']);
  identityMocks.listIdentityCandidates.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
  identityMocks.decideIdentityCandidate.mockResolvedValue(candidate);
  identityMocks.undoIdentityCandidate.mockResolvedValue(candidate);
  accessMocks.canAccessAllLineAccounts.mockResolvedValue(true);
  accessMocks.getVisibleLineAccountScope.mockResolvedValue({
    allowedAccountIds: ['account-a', 'account-b'], canSeeUnassigned: false,
  });
  detectorMocks.detectFriendDuplicateCandidates.mockResolvedValue({
    processed: 1, hasMore: false, nextCursor: null,
  });
});

describe('identity candidate HTTP contract', () => {
  it('requires a candidate kind and returns the normal empty list shape', async () => {
    const app = harness();
    const missing = await app.request('/api/identity-candidates');
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ success: false, code: 'KIND_REQUIRED' });

    const empty = await app.request('/api/identity-candidates?kind=friend_duplicate');
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({
      success: true, data: { items: [], total: 0, limit: 20, offset: 0 },
    });
  });

  it('lets an owner detect friend candidates only inside the visible account scope', async () => {
    const response = await harness().request(
      '/api/identity-candidates/detect?kind=friend_duplicate&limit=25',
      { method: 'POST' },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true, data: { processed: 1, hasMore: false, nextCursor: null },
    });
    expect(detectorMocks.detectFriendDuplicateCandidates).toHaveBeenCalledWith(
      expect.anything(),
      {
        tenantId: 'tenant-a',
        allowedAccountIds: ['account-a', 'account-b'],
        limit: 25,
        after: null,
      },
    );
  });

  it('does not let staff run detection or accept another candidate kind', async () => {
    const staffResponse = await harness({ role: 'staff', permissions: ['/friends'] }).request(
      '/api/identity-candidates/detect?kind=friend_duplicate',
      { method: 'POST' },
    );
    expect(staffResponse.status).toBe(403);

    const wrongKind = await harness().request(
      '/api/identity-candidates/detect?kind=ec_member',
      { method: 'POST' },
    );
    expect(wrongKind.status).toBe(400);
    expect(await wrongKind.json()).toMatchObject({ code: 'INVALID_DETECTION_KIND' });
    expect(detectorMocks.detectFriendDuplicateCandidates).not.toHaveBeenCalled();
  });

  it('does not let a friends-only staff member inspect EC candidates', async () => {
    const ec = { ...candidate, kind: 'ec_member' as const };
    identityMocks.getIdentityCandidate.mockResolvedValue(ec);
    const response = await harness({ role: 'staff', permissions: ['/friends'] })
      .request('/api/identity-candidates/candidate-a');
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain('ta***@example.jp');
    expect(identityMocks.candidateAccountIds).not.toHaveBeenCalled();
  });

  it('does not reveal candidate details outside the visible account scope', async () => {
    accessMocks.canAccessAllLineAccounts.mockResolvedValue(false);
    const response = await harness().request('/api/identity-candidates/candidate-a');
    expect(response.status).toBe(404);
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain('\u7530\u4e2d');
    expect(body).not.toContain('ta***@example.jp');
  });

  it('does not let staff mutate identity decisions', async () => {
    const staff = harness({ role: 'staff', permissions: ['/friends'] });
    const decided = await staff.request('/api/identity-candidates/candidate-a/decide', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 1, decision: 'linked', reason: '本人へ確認済みです' }),
    });
    const undone = await staff.request('/api/identity-candidates/candidate-a/undo', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 1, reason: '判定を見直します' }),
    });
    expect(decided.status).toBe(403);
    expect(undone.status).toBe(403);
    expect(identityMocks.decideIdentityCandidate).not.toHaveBeenCalled();
    expect(identityMocks.undoIdentityCandidate).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before deciding', async () => {
    const response = await harness().request('/api/identity-candidates/candidate-a/decide', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ success: false, code: 'INVALID_JSON' });
    expect(identityMocks.decideIdentityCandidate).not.toHaveBeenCalled();
  });

  it('returns a 409 when the expected version is stale', async () => {
    identityMocks.decideIdentityCandidate.mockRejectedValue(
      new identityMocks.IdentityCandidateError(
        409, 'STALE_CANDIDATE', '\u5225\u306e\u4eba\u304c\u5148\u306b\u5224\u5b9a\u3057\u307e\u3057\u305f\u3002\u6700\u65b0\u306e\u72b6\u614b\u3092\u8aad\u307f\u76f4\u3057\u3066\u304f\u3060\u3055\u3044',
      ),
    );
    const response = await harness().request('/api/identity-candidates/candidate-a/decide', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 1, decision: 'linked', reason: '\u672c\u4eba\u3078\u78ba\u8a8d\u6e08\u307f\u3067\u3059' }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ success: false, code: 'STALE_CANDIDATE' });
  });
});
