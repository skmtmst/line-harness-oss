import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const personMocks = vi.hoisted(() => {
  class TestMergedPersonError extends Error {
    constructor(
      public readonly status: 400 | 403 | 404 | 409 | 422,
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    getMergedPerson: vi.fn(),
    mergedPersonAccountIds: vi.fn(),
    updateMergedPerson: vi.fn(),
    updateMergedPersonDeliveryPriorities: vi.fn(),
    MergedPersonError: TestMergedPersonError,
  };
});

const accessMocks = vi.hoisted(() => ({ canAccessAllLineAccounts: vi.fn() }));

vi.mock('../services/merged-people.js', () => personMocks);
vi.mock('../services/account-access.js', () => accessMocks);

const { mergedPeople } = await import('./merged-people.js');

const detail = {
  id: 'user-a', status: 'active', revision: 1, primaryDisplayName: '田中 花子',
  linkedFriends: [{
    friendId: 'friend-a', displayName: '田中 花子', lineAccountId: 'account-a',
    lineAccountName: '本店', isFollowing: true, linkedAt: '2026-08-30',
    linkMethod: 'operator_review', confidence: 92, candidateId: 'candidate-a', candidateVersion: 2,
  }],
  profileValues: [{
    fieldKey: 'email', fieldLabel: 'メール', valuePreview: 'ta***@example.jp',
    sourceType: 'form', sourceLabel: '来店アンケート', sourceFriendId: 'friend-a',
    verifiedAt: null, selectedByName: '担当者', selectedAt: '2026-08-30', updateMode: 'fixed',
  }],
  deliveryPriorities: [], history: [], createdAt: '2026-08-30', updatedAt: '2026-08-30', archivedAt: null,
};

function harness(options?: { role?: 'owner' | 'admin' | 'staff'; permissions?: string[] }) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.env = { DB: {} as D1Database } as Env['Bindings'];
    c.set('staff', {
      id: 'staff-a', name: '担当者', role: options?.role ?? 'owner', readOnly: false,
      tenantId: 'tenant-a', permissionKeys: options?.permissions ?? ['/friends'],
      assignedLineAccountId: null, canAccessDescendantAccounts: false,
    });
    await next();
  });
  app.route('/', mergedPeople);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  personMocks.getMergedPerson.mockResolvedValue(detail);
  personMocks.mergedPersonAccountIds.mockResolvedValue(['account-a']);
  personMocks.updateMergedPerson.mockResolvedValue({ ...detail, revision: 2 });
  personMocks.updateMergedPersonDeliveryPriorities.mockResolvedValue({ ...detail, revision: 2 });
  accessMocks.canAccessAllLineAccounts.mockResolvedValue(true);
});

describe('merged person HTTP contract', () => {
  it('returns the normal detail shape only after every linked account is authorized', async () => {
    const response = await harness({ role: 'staff' }).request('/api/friends/people/user-a');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: detail });
    expect(accessMocks.canAccessAllLineAccounts).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ id: 'staff-a' }), ['account-a'],
    );
  });

  it('does not load or leak profile details outside the visible account scope', async () => {
    accessMocks.canAccessAllLineAccounts.mockResolvedValue(false);
    const response = await harness({ role: 'staff' }).request('/api/friends/people/user-a');
    expect(response.status).toBe(403);
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain('田中');
    expect(body).not.toContain('ta***@example.jp');
    expect(personMocks.getMergedPerson).not.toHaveBeenCalled();
  });

  it('requires owner or admin for profile changes and parses the expected revision', async () => {
    const denied = await harness({ role: 'staff' }).request('/api/friends/people/user-a', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, primaryDisplayName: '新しい名前' }),
    });
    expect(denied.status).toBe(403);

    const accepted = await harness({ role: 'admin' }).request('/api/friends/people/user-a', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, primaryDisplayName: '新しい名前' }),
    });
    expect(accepted.status).toBe(200);
    expect(personMocks.updateMergedPerson).toHaveBeenCalledWith(
      expect.anything(),
      { id: 'staff-a', name: '担当者', tenantId: 'tenant-a' },
      'user-a',
      { expectedRevision: 1, primaryDisplayName: '新しい名前' },
    );
  });

  it('returns 422 for malformed JSON and 409 for a stale revision', async () => {
    const malformed = await harness().request('/api/friends/people/user-a', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{',
    });
    expect(malformed.status).toBe(422);
    expect(await malformed.json()).toMatchObject({ success: false, code: 'INVALID_JSON' });

    personMocks.updateMergedPerson.mockRejectedValue(
      new personMocks.MergedPersonError(
        409, 'STALE_PERSON', '別の人が先に変更しました。最新の状態を読み直してください',
      ),
    );
    const stale = await harness().request('/api/friends/people/user-a', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, primaryDisplayName: '新しい名前' }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ success: false, code: 'STALE_PERSON' });
  });

  it('accepts an explicit empty priority list instead of turning it into missing data', async () => {
    const response = await harness().request(
      '/api/friends/people/user-a/delivery-priorities',
      {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: 1, priorities: [] }),
      },
    );
    expect(response.status).toBe(200);
    expect(personMocks.updateMergedPersonDeliveryPriorities).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 'user-a', { expectedRevision: 1, priorities: [] },
    );
  });
});
