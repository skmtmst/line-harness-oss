import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  canAccess: vi.fn(),
  getVisibleScope: vi.fn(),
  register: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: mocks.canAccess,
  getVisibleLineAccountScope: mocks.getVisibleScope,
}));
vi.mock('../services/meet-consultation-reminders.js', () => ({
  registerMeetConsultation: mocks.register,
  cancelMeetConsultation: mocks.cancel,
}));

const { meetConsultations } = await import('./meet-consultations.js');

type Query = { sql: string; binds: unknown[] };

function harness(withStaff = true) {
  const queries: Query[] = [];
  const db = {
    prepare(sql: string) {
      const query = { sql, binds: [] as unknown[] };
      queries.push(query);
      const statement = {
        bind(...binds: unknown[]) { query.binds = binds; return statement; },
        async first() {
          if (sql.includes('FROM meet_consultations c')) return { line_account_id: 'account-a' };
          if (sql.includes('FROM friends WHERE id')) return { line_account_id: 'account-a' };
          return null;
        },
        async all() { return { results: [] }; },
      };
      return statement;
    },
  } as unknown as D1Database;
  const app = new Hono<any>();
  if (withStaff) {
    app.use('*', async (c, next) => {
      c.set('staff', { id: 'staff-a', name: '担当者', role: 'staff', readOnly: false });
      await next();
    });
  }
  app.route('/', meetConsultations);
  return { app, db, queries };
}

function json(body: unknown) {
  return {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  };
}

const booking = {
  externalEventId: 'google-event-a', friendId: 'friend-a', title: '個別相談',
  startsAt: '2026-10-01T01:00:00.000Z', endsAt: '2026-10-01T02:00:00.000Z',
  meetUrl: 'https://meet.google.com/abc-defg-hij',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canAccess.mockResolvedValue(true);
  mocks.getVisibleScope.mockResolvedValue({
    accounts: [], allowedAccountIds: ['account-a'], canSeeUnassigned: false, ids: ['account-a'],
  });
  mocks.register.mockResolvedValue({ id: 'consultation-a', reminders: [] });
  mocks.cancel.mockResolvedValue(true);
});

describe('Meet consultation account boundary', () => {
  test('requires an allowed staff role for the list', async () => {
    const { app, db } = harness(false);
    expect((await app.request('/api/meet-consultations', {}, { DB: db })).status).toBe(403);
  });

  test('lists consultations only for visible LINE accounts', async () => {
    const { app, db, queries } = harness();
    const response = await app.request('/api/meet-consultations?status=confirmed', {}, { DB: db });

    expect(response.status).toBe(200);
    const query = queries.find((item) => item.sql.includes('FROM meet_consultations c'))!;
    expect(query.sql).toContain('f.line_account_id IN (?)');
    expect(query.binds).toEqual(['confirmed', 'confirmed', 'account-a']);
  });

  test('rejects another-account registration before changing reminders', async () => {
    mocks.canAccess.mockResolvedValue(false);
    const { app, db } = harness();
    const response = await app.request('/api/meet-consultations', json(booking), { DB: db });

    expect(response.status).toBe(404);
    expect(mocks.register).not.toHaveBeenCalled();
  });

  test('cannot overwrite an existing consultation owned by another account', async () => {
    mocks.canAccess.mockImplementation(async (_db, _staff, accountIds: Array<string | null>) => (
      accountIds.every((accountId) => accountId == null || accountId === 'account-a')
    ));
    const { app, db } = harness();
    const originalPrepare = (db as any).prepare.bind(db);
    (db as any).prepare = (sql: string) => {
      const statement = originalPrepare(sql);
      if (sql.includes('FROM meet_consultations c')) {
        statement.first = vi.fn(async () => ({ line_account_id: 'account-b' }));
      }
      return statement;
    };

    const response = await app.request('/api/meet-consultations', json(booking), { DB: db });

    expect(response.status).toBe(404);
    expect(mocks.register).not.toHaveBeenCalled();
  });

  test('rejects another-account cancellation before changing reminders', async () => {
    mocks.canAccess.mockResolvedValue(false);
    const { app, db } = harness();
    const response = await app.request(
      '/api/meet-consultations/google-event-a', { method: 'DELETE' }, { DB: db },
    );

    expect(response.status).toBe(404);
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  test('keeps registration and cancellation working inside the visible account', async () => {
    const { app, db } = harness();
    const created = await app.request('/api/meet-consultations', json(booking), { DB: db });
    const cancelled = await app.request(
      '/api/meet-consultations/google-event-a', { method: 'DELETE' }, { DB: db },
    );

    expect(created.status).toBe(201);
    expect(cancelled.status).toBe(200);
    expect(mocks.register).toHaveBeenCalledWith(db, booking);
    expect(mocks.cancel).toHaveBeenCalledWith(
      db, 'google-event-a', expect.any(Date), { failOnSendInFlight: true },
    );
  });
});
