import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../index.js';

const access = vi.hoisted(() => vi.fn());

vi.mock('../services/account-access.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/account-access.js')>();
  return { ...actual, canAccessAllLineAccounts: access };
});

const { ecCommerce } = await import('./ec-commerce.js');

type Row = Record<string, unknown>;

function fakeDb(rows: Row[] = []) {
  const calls: Array<{ sql: string; bindings: unknown[] }> = [];
  return {
    calls,
    prepare(sql: string) {
      const statement = {
        bindings: [] as unknown[],
        bind(...bindings: unknown[]) {
          statement.bindings = bindings;
          calls.push({ sql, bindings });
          return statement;
        },
        all: async () => ({ results: rows }),
        first: async () => sql.includes('COUNT(*)')
          ? { count: rows.length }
          : { accepted: 1, failed: 1, excluded: 1, pending: 1 },
      };
      return statement;
    },
  };
}

function app() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: 'owner-a', name: '管理者', role: 'owner', readOnly: false, tenantId: 'tenant-a',
    });
    await next();
  });
  instance.route('/', ecCommerce);
  return instance;
}

function notificationRow(overrides: Row = {}): Row {
  return {
    id: 'event-a',
    external_event_id: 'external-a',
    event_type: 'ec.order.confirmed',
    status: 'processed',
    error_message: null,
    received_at: '2026-08-28T09:00:00+09:00',
    processed_at: '2026-08-28T09:00:02+09:00',
    order_number: 'NEN-1001',
    friend_id: 'friend-a',
    friend_name: '小林 彩',
    ...overrides,
  };
}

beforeEach(() => {
  access.mockReset();
  access.mockResolvedValue(true);
});

describe('GET /api/ec-commerce/notification-runs', () => {
  it('requires an explicitly selected LINE account', async () => {
    const db = fakeDb();
    const response = await app().request('/api/ec-commerce/notification-runs', {}, { DB: db } as never);
    expect(response.status).toBe(400);
    expect(access).not.toHaveBeenCalled();
    expect(db.calls).toHaveLength(0);
  });

  it('rejects a LINE account outside the operator scope', async () => {
    access.mockResolvedValue(false);
    const db = fakeDb();
    const response = await app().request(
      '/api/ec-commerce/notification-runs?lineAccountId=account-b', {}, { DB: db } as never,
    );
    expect(response.status).toBe(403);
    expect(db.calls).toHaveLength(0);
  });

  it('scopes every query through the selected friend account and excludes profile-only events', async () => {
    const db = fakeDb([notificationRow()]);
    const response = await app().request(
      '/api/ec-commerce/notification-runs?lineAccountId=account-a', {}, { DB: db } as never,
    );
    expect(response.status).toBe(200);
    expect(access).toHaveBeenCalledWith(db, expect.anything(), ['account-a']);
    expect(db.calls).toHaveLength(3);
    for (const call of db.calls) {
      expect(call.sql).toContain('f.line_account_id = ?');
      expect(call.sql).not.toContain('ec.customer.profile_updated');
      expect(call.bindings[0]).toBe('account-a');
    }
  });

  it('returns LINE API acceptance without claiming delivery or read status', async () => {
    const db = fakeDb([notificationRow()]);
    const response = await app().request(
      '/api/ec-commerce/notification-runs?lineAccountId=account-a', {}, { DB: db } as never,
    );
    const body = await response.json() as {
      data: { items: Array<Record<string, unknown>>; coverage: Record<string, unknown> };
    };
    expect(body.data.items[0]).toMatchObject({
      status: 'accepted', acceptedAt: '2026-08-28T09:00:02+09:00',
      attemptCount: null, clickedAt: null, retryAvailable: false,
    });
    expect(JSON.stringify(body)).not.toMatch(/届きました|開きました|既読/);
    expect(body.data.coverage).toMatchObject({
      unassignedHistoricalRowsExcluded: true,
      attemptHistoryAvailable: false,
      retryAvailable: false,
    });
  });

  it('does not expose raw upstream errors and distinguishes excluded from failed', async () => {
    const rows = [
      notificationRow({ id: 'failed', status: 'failed', error_message: 'secret upstream response' }),
      notificationRow({ id: 'skipped', status: 'skipped', error_message: 'notification_disabled' }),
    ];
    const response = await app().request(
      '/api/ec-commerce/notification-runs?lineAccountId=account-a', {}, { DB: fakeDb(rows) } as never,
    );
    const body = await response.json() as { data: { items: Array<Record<string, unknown>> } };
    expect(body.data.items[0]).toMatchObject({ status: 'failed' });
    expect(body.data.items[1]).toMatchObject({
      status: 'excluded', reason: 'このお知らせが停止中だったため、送信しませんでした',
    });
    expect(JSON.stringify(body)).not.toContain('secret upstream response');
  });

  it('adds the failed-only predicate only for the failures view', async () => {
    const db = fakeDb([]);
    const response = await app().request(
      '/api/ec-commerce/notification-runs?lineAccountId=account-a&view=failures', {}, { DB: db } as never,
    );
    expect(response.status).toBe(200);
    expect(db.calls.filter((call) => /AND e\.status = 'failed'/.test(call.sql))).toHaveLength(2);
  });
});
