import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';

const mocks = vi.hoisted(() => ({
  getVisibleLineAccountScope: vi.fn(),
  getActivityDigest: vi.fn(),
  computeUnansweredInbox: vi.fn(),
  countUnanswered: vi.fn(),
}));

vi.mock('../services/account-access.js', () => ({
  getVisibleLineAccountScope: mocks.getVisibleLineAccountScope,
}));
vi.mock('../services/activity-digest.js', () => ({
  getActivityDigest: mocks.getActivityDigest,
  parseActivityDigestHours: () => 3,
}));
vi.mock('../services/unanswered-inbox.js', () => ({
  computeUnansweredInbox: mocks.computeUnansweredInbox,
  countUnanswered: mocks.countUnanswered,
}));

import { inbox } from './inbox.js';

const db = {} as D1Database;
const staff: AuthenticatedStaff = {
  id: 'staff-b',
  name: 'B staff',
  role: 'staff',
  readOnly: false,
  tenantId: 'tenant-b',
};

function request(path: string, authenticatedStaff?: AuthenticatedStaff) {
  const app = new Hono<Env>();
  if (authenticatedStaff) {
    app.use('*', async (c, next) => {
      c.set('staff', authenticatedStaff);
      return next();
    });
  }
  app.route('/', inbox);
  return app.request(path, {}, { DB: db } as Env['Bindings']);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getVisibleLineAccountScope.mockResolvedValue({
    accounts: [],
    ids: ['account-b'],
    allowedAccountIds: ['account-b'],
    canSeeUnassigned: false,
  });
  mocks.getActivityDigest.mockResolvedValue({});
  mocks.computeUnansweredInbox.mockResolvedValue({ total: 0, page: 1, pageSize: 50, rows: [] });
  mocks.countUnanswered.mockResolvedValue({ total: 0, byAccount: [], oldestWaitMinutes: null });
});

describe('inbox tenant scope', () => {
  test('activity-digest resolves scope for API-key callers and passes the default-tenant result', async () => {
    mocks.getVisibleLineAccountScope.mockResolvedValue({
      accounts: [],
      ids: ['account-default'],
      allowedAccountIds: ['account-default'],
      canSeeUnassigned: true,
    });

    expect((await request('/api/inbox/activity-digest?hours=3')).status).toBe(200);
    expect(mocks.getVisibleLineAccountScope).toHaveBeenCalledWith(db, undefined);
    expect(mocks.getActivityDigest).toHaveBeenCalledWith(db, {
      hours: 3,
      allowedAccountIds: ['account-default'],
      canSeeUnassigned: true,
    });
  });

  test('unanswered list passes the authenticated tenant scope', async () => {
    expect((await request('/api/inbox/unanswered', staff)).status).toBe(200);
    expect(mocks.getVisibleLineAccountScope).toHaveBeenCalledWith(db, staff);
    expect(mocks.computeUnansweredInbox).toHaveBeenCalledWith(db, expect.objectContaining({
      allowedAccountIds: ['account-b'],
      canSeeUnassigned: false,
    }));
  });

  test('unanswered list passes search and DB pagination options with the tenant scope', async () => {
    const response = await request(
      '/api/inbox/unanswered?q=%E8%A6%81%E7%A2%BA%E8%AA%8D&account=account-b&minWaitMinutes=45&page=3&pageSize=25',
      staff,
    );

    expect(response.status).toBe(200);
    expect(mocks.computeUnansweredInbox).toHaveBeenCalledWith(db, {
      q: '要確認',
      account: 'account-b',
      minWaitMinutes: 45,
      page: 3,
      pageSize: 25,
      allowedAccountIds: ['account-b'],
      canSeeUnassigned: false,
    });
  });

  test('unanswered count passes the authenticated tenant scope', async () => {
    expect((await request('/api/inbox/unanswered/count', staff)).status).toBe(200);
    expect(mocks.getVisibleLineAccountScope).toHaveBeenCalledWith(db, staff);
    expect(mocks.countUnanswered).toHaveBeenCalledWith(db, {
      allowedAccountIds: ['account-b'],
      canSeeUnassigned: false,
    });
  });
});
