import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js';

const liffAuth = vi.hoisted(() => ({
  verifyCallerLineUserId: vi.fn(),
}));
vi.mock('../services/liff-auth.js', () => liffAuth);

const mileage = vi.hoisted(() => ({ awardActivityMileage: vi.fn() }));
vi.mock('../services/activity-mileage.js', () => mileage);

const { default: events } = await import('./events.js');

type TestEnv = {
  Variables: { staff: { id: string; role: 'owner'; tenantId: string } };
  Bindings: { DB: D1Database };
};

function setup() {
  const testDb = createTestD1({ foreignKeys: true });
  let requestDb = testDb.db;
  testDb.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-a', 'A社'), ('tenant-b', 'B社')`).run();
  testDb.raw.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret, liff_id, is_active, tenant_id)
     VALUES
       ('account-a', 'channel-a', 'A', '', '', 'liff-a', 1, 'tenant-a'),
       ('account-b', 'channel-b', 'B', '', '', 'liff-b', 1, 'tenant-b')`,
  ).run();
  insertFriend(testDb.raw, 'friend-a', {
    line_account_id: 'account-a',
    line_user_id: 'U-a',
  });
  const app = new Hono<TestEnv>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-a', role: 'owner', tenantId: 'tenant-a' });
    c.env = { DB: requestDb };
    await next();
  });
  app.route('/', events);
  return {
    app,
    ...testDb,
    setRequestDb(db: D1Database) { requestDb = db; },
  };
}

function concurrentUpdateDb(base: D1Database): D1Database {
  let reads = 0;
  let releaseReads!: () => void;
  const bothRead = new Promise<void>((resolve) => { releaseReads = resolve; });
  let batchTail = Promise.resolve();

  function wrap(statement: D1PreparedStatement, barrier: boolean): D1PreparedStatement {
    return {
      bind(...values: unknown[]) {
        return wrap(statement.bind(...values), barrier);
      },
      async first<T>(column?: string) {
        if (barrier && reads < 2) {
          reads++;
          if (reads === 2) releaseReads();
          await bothRead;
        }
        return column === undefined ? statement.first<T>() : statement.first<T>(column);
      },
      all: <T>() => statement.all<T>(),
      run: <T>() => statement.run<T>(),
      raw: <T>() => statement.raw<T>(),
    } as unknown as D1PreparedStatement;
  }

  return {
    prepare(query: string) {
      const isInitialEventRead = /SELECT \* FROM events[\s\S]*WHERE id = \? AND deleted_at IS NULL/.test(query);
      return wrap(base.prepare(query), isInitialEventRead);
    },
    async batch(statements: D1PreparedStatement[]) {
      let releaseBatch!: () => void;
      const prior = batchTail;
      batchTail = new Promise<void>((resolve) => { releaseBatch = resolve; });
      await prior;
      try {
        return await base.batch(statements);
      } finally {
        releaseBatch();
      }
    },
  } as unknown as D1Database;
}

async function createPublishedEvent(
  app: Hono<TestEnv>,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const response = await app.request('/api/events/admin/events?account_id=account-a', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: '公開時のイベント名',
      venue_name: '公開時の会場',
      requires_approval: 1,
      approval_deadline_hours: 24,
      is_published: 1,
      ...overrides,
    }),
  });
  expect(response.status).toBe(201);
  return response.json() as Promise<Record<string, unknown>>;
}

beforeEach(() => {
  liffAuth.verifyCallerLineUserId.mockReset();
  liffAuth.verifyCallerLineUserId.mockResolvedValue('U-a');
  mileage.awardActivityMileage.mockReset();
  mileage.awardActivityMileage.mockResolvedValue(undefined);
});

describe('N-418 公開版と申込履歴の固定', () => {
  test('同じexpected versionの並行更新は1件だけ成功し、version 2を1行だけ作る', async () => {
    const { app, raw, db, setRequestDb } = setup();
    const event = await createPublishedEvent(app);
    setRequestDb(concurrentUpdateDb(db));

    const update = (body: Record<string, unknown>) => app.request(
      `/api/events/admin/events/${event.id}?account_id=account-a`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, expected_version: 1 }),
      },
    );
    const responses = await Promise.all([
      update({ name: '並行更新A' }),
      update({ venue_name: '並行更新B' }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((raw.prepare(
      `SELECT version, version_write_token FROM events WHERE id = ?`,
    ).get(event.id))).toEqual({ version: 2, version_write_token: null });
    expect(raw.prepare(
      `SELECT version_number, COUNT(*) AS count
         FROM event_versions WHERE event_id = ? GROUP BY version_number ORDER BY version_number`,
    ).all(event.id)).toEqual([
      { version_number: 1, count: 1 },
      { version_number: 2, count: 1 },
    ]);
  });

  test('expected versionが古い更新は409となり、イベントも公開版も増えない', async () => {
    const { app, raw } = setup();
    const event = await createPublishedEvent(app);

    const first = await app.request(`/api/events/admin/events/${event.id}?account_id=account-a`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '更新後', expected_version: 1 }),
    });
    expect(first.status).toBe(200);
    expect((await first.json() as { version: number }).version).toBe(2);

    const stale = await app.request(`/api/events/admin/events/${event.id}?account_id=account-a`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ venue_name: '競合した会場', expected_version: 1 }),
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toEqual({ error: 'version_conflict' });

    const stored = raw.prepare(
      `SELECT name, venue_name, version, version_write_token FROM events WHERE id = ?`,
    ).get(event.id) as { name: string; venue_name: string; version: number; version_write_token: string | null };
    expect(stored).toEqual({
      name: '更新後',
      venue_name: '公開時の会場',
      version: 2,
      version_write_token: null,
    });
    const versions = raw.prepare(
      `SELECT version_number, json_extract(snapshot_json, '$.eventName') AS name
         FROM event_versions WHERE event_id = ? ORDER BY version_number`,
    ).all(event.id) as Array<{ version_number: number; name: string }>;
    expect(versions).toEqual([
      { version_number: 1, name: '公開時のイベント名' },
      { version_number: 2, name: '更新後' },
    ]);
  });

  test('申込後に名前・会場・日時を編集してもLIFF履歴は申込時点を返す', async () => {
    const { app, raw } = setup();
    const event = await createPublishedEvent(app);
    const slot = await app.request(`/api/events/admin/events/${event.id}/slots?account_id=account-a`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slots: [{
        starts_at: '2099-01-10T01:00:00.000Z',
        ends_at: '2099-01-10T02:00:00.000Z',
      }] }),
    });
    expect(slot.status).toBe(201);
    const slotId = ((await slot.json()) as { items: Array<{ id: string }> }).items[0].id;

    const booked = await app.request(`/api/liff/events/${event.id}/bookings?liffId=liff-a`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test',
        'content-type': 'application/json',
        'idempotency-key': 'booking-snapshot-1',
      },
      body: JSON.stringify({ slot_id: slotId }),
    });
    expect(booked.status).toBe(201);
    const bookingId = ((await booked.json()) as { id: string }).id;

    const updated = await app.request(`/api/events/admin/events/${event.id}?account_id=account-a`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '編集後のイベント名',
        venue_name: '編集後の会場',
        expected_version: 1,
      }),
    });
    expect(updated.status).toBe(200);
    raw.prepare(
      `UPDATE event_slots SET starts_at = '2099-02-20T03:00:00.000Z', ends_at = '2099-02-20T04:00:00.000Z'
        WHERE id = ?`,
    ).run(slotId);

    const history = await app.request(`/api/liff/events/me/${bookingId}?liffId=liff-a`, {
      headers: { authorization: 'Bearer test' },
    });
    expect(history.status).toBe(200);
    await expect(history.json()).resolves.toMatchObject({
      event_name: '公開時のイベント名',
      venue_name: '公開時の会場',
      slot_starts_at: '2099-01-10T01:00:00.000Z',
      slot_ends_at: '2099-01-10T02:00:00.000Z',
    });

    const snapshot = raw.prepare(
      `SELECT event_version_id, event_snapshot_json FROM event_bookings WHERE id = ?`,
    ).get(bookingId) as { event_version_id: string; event_snapshot_json: string };
    expect(snapshot.event_version_id).toBe(event.current_published_version_id);
    expect(JSON.parse(snapshot.event_snapshot_json)).toMatchObject({
      eventName: '公開時のイベント名',
      venueName: '公開時の会場',
      slotStartsAt: '2099-01-10T01:00:00.000Z',
    });
  });

  test('別accountのevent idを直接指定しても更新できない', async () => {
    const { app, raw } = setup();
    raw.prepare(
      `INSERT INTO events (id, line_account_id, name, is_published)
       VALUES ('event-b', 'account-b', 'B社イベント', 1)`,
    ).run();
    const response = await app.request('/api/events/admin/events/event-b?account_id=account-a', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '越境更新', expected_version: 1 }),
    });
    expect(response.status).toBe(404);
    expect((raw.prepare(`SELECT name FROM events WHERE id = 'event-b'`).get() as { name: string }).name)
      .toBe('B社イベント');
  });
});

describe('N-422 申込時点の承認期限', () => {
  test('2/24/72以外は保存前に拒否する', async () => {
    const { app, raw } = setup();
    const response = await app.request('/api/events/admin/events?account_id=account-a', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '不正な期限',
        is_published: 1,
        approval_deadline_hours: 12,
      }),
    });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_approval_deadline_hours' });
    expect((raw.prepare(`SELECT COUNT(*) AS count FROM events`).get() as { count: number }).count).toBe(0);
    expect((raw.prepare(`SELECT COUNT(*) AS count FROM event_versions`).get() as { count: number }).count).toBe(0);
  });

  test.each([2, 24, 72])('%i時間を申込行へ固定する', async (hours) => {
    const { app, raw } = setup();
    const event = await createPublishedEvent(app, { approval_deadline_hours: hours });
    const slot = await app.request(`/api/events/admin/events/${event.id}/slots?account_id=account-a`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slots: [{
        starts_at: '2099-01-10T01:00:00.000Z',
        ends_at: '2099-01-10T02:00:00.000Z',
      }] }),
    });
    const slotId = ((await slot.json()) as { items: Array<{ id: string }> }).items[0].id;
    const booked = await app.request(`/api/liff/events/${event.id}/bookings?liffId=liff-a`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test',
        'content-type': 'application/json',
        'idempotency-key': `deadline-${hours}`,
      },
      body: JSON.stringify({ slot_id: slotId }),
    });
    expect(booked.status).toBe(201);
    const bookingId = ((await booked.json()) as { id: string }).id;
    const row = raw.prepare(
      `SELECT requested_at, approval_expires_at FROM event_bookings WHERE id = ?`,
    ).get(bookingId) as { requested_at: string; approval_expires_at: string };
    expect(Date.parse(row.approval_expires_at) - Date.parse(row.requested_at)).toBe(hours * 3_600_000);
  });
});
