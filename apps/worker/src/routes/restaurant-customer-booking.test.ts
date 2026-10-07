import { Hono } from 'hono';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
const mocks = vi.hoisted(() => ({
  send: vi.fn(async (_env: unknown, _input: unknown) => true),
}));
vi.mock('../services/booking-automatic-line.js', () => ({
  sendAutomaticBookingLine: mocks.send,
}));
vi.mock('../services/waitlist-tick.js', () => ({
  processBookingWaitlists: vi.fn(),
}));
vi.mock('@line-crm/db', async (o) => ({
  ...(await o<Record<string, unknown>>()),
  isAccountFeatureEnabled: vi.fn(async () => true),
}));
import { restaurantCustomerBooking } from './restaurant-customer-booking.js';
import {
  customerAvailability,
  processRestaurantCustomerNotices,
} from '../services/restaurant-customer-booking.js';
let db: SqliteD1;
async function read(r: Response) {
  return (await r.json()) as {
    data: import('@line-crm/shared').RestaurantCustomerBooking;
  };
}
const start = '2027-10-01T03:00:00.000Z';
function app() {
  const a = new Hono<Env>();
  a.use('*', async (c, next) => {
    c.env = { DB: db.db, RESTAURANT_TEST_ENABLED: 'true' } as Env['Bindings'];
    await next();
  });
  a.route('/', restaurantCustomerBooking);
  return a;
}
const request = (path: string, body?: unknown, token = 'one') =>
  app().request(path + (path.includes('?') ? '&' : '?') + 'liffId=liff1', {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const hold = (requestId = 'request_123', token = 'one') =>
  request(
    '/api/liff/restaurant/holds',
    { storeId: 'store', startsAt: start, guestCount: 2, requestId },
    token,
  );
beforeEach(() => {
  vi.clearAllMocks();
  db = createTestD1();
  db.raw.exec(`
 INSERT INTO tenants(id,name) VALUES('t1','1'),('t2','2');
 INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,login_channel_id,liff_id,tenant_id) VALUES('a1','1','1','','','login1','liff1','t1'),('a2','2','2','','','login2','liff2','t2');
 INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES('f1','Uone','a1','本人'),('f2','Utwo','a1','二人目');
 INSERT INTO rt_organizations(id,account_id,name) VALUES('org','a1','店');
 INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES('store','org','店','s','a1');
 INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES('other','org','他店','o','a2');
 INSERT INTO rt_tables(id,store_id,code,label,seat_type,max_capacity) VALUES('table1','store','1','卓1','table',4),('table2','store','2','卓2','table',4);
 INSERT INTO rt_media(id,code,name,sender_addresses,parser_key) VALUES('media','hotpepper','媒体','[]','hp');
 INSERT INTO rt_store_media_links(store_id,media_id,close_on_booking) VALUES('store','media',1);
 INSERT INTO booking_settings(id,line_account_id,booking_window_days,cutoff_minutes_before,cancel_deadline_minutes_before) VALUES('bs','a1',365,0,0);
 `);
  db.raw
    .prepare(
      "INSERT INTO rt_opening_hours_settings(store_id,hours_json,updated_by) VALUES('store',?,'staff')",
    )
    .run(
      JSON.stringify(
        Array.from({ length: 7 }, (_, weekday) => ({
          weekday,
          periods: [{ opensAt: '12:00', closesAt: '16:00' }],
        })),
      ),
    );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      const b = new URLSearchParams(String(init?.body));
      return new Response(
        JSON.stringify({
          sub: 'U' + b.get('id_token'),
          aud: b.get('client_id'),
          exp: Date.now() / 1000 + 3600,
        }),
        { status: 200 },
      );
    }),
  );
});
afterEach(() => {
  db.raw.close();
  vi.unstubAllGlobals();
});
describe('飲食店の本人予約', () => {
  it('仮押さえ→確定→変更→取消。通知と媒体の知らせを一度だけ作る', async () => {
    const h = await hold();
    expect(h.status).toBe(201);
    const { data } = await read(h);
    expect(data.status).toBe('pending');
    expect((await hold()).status).toBe(200);
    const confirm = await request(
      `/api/liff/restaurant/reservations/${data.id}/confirm`,
      { expectedVersion: 1 },
    );
    expect(confirm.status).toBe(200);
    const confirmed = (await read(confirm)).data;
    expect(confirmed.version).toBe(2);
    expect(
      db.raw.prepare('SELECT COUNT(*) n FROM rt_reservation_close_tasks').get(),
    ).toEqual({ n: 1 });
    await request(`/api/liff/restaurant/reservations/${data.id}/confirm`, {
      expectedVersion: 1,
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const change = await request(
      `/api/liff/restaurant/reservations/${data.id}/reschedule`,
      { expectedVersion: 2, startsAt: '2027-10-01T04:00:00Z', guestCount: 2 },
    );
    expect(change.status).toBe(200);
    const cancelled = await request(
      `/api/liff/restaurant/reservations/${data.id}/cancel`,
      { expectedVersion: 3 },
    );
    expect(cancelled.status).toBe(200);
    expect(db.raw.prepare('SELECT status FROM rt_reservations').get()).toEqual({
      status: 'cancelled',
    });
    expect(
      db.raw
        .prepare('SELECT DISTINCT status FROM rt_reservation_close_tasks')
        .all(),
    ).toEqual([{ status: 'reopen' }]);
    expect(mocks.send.mock.calls[0]?.[1]).toMatchObject({
      featureId: 'restaurant_test',
      to: 'Uone',
    });
  });
  it('同じ本人の同時予約、同じ卓の同時確保をDBで拒否する', async () => {
    const [a, b] = await Promise.all([
      hold('request_one'),
      hold('request_two'),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(() =>
      db.raw.exec(
        `INSERT INTO rt_reservations(id,store_id,source,external_id,customer_name,line_uid,guest_count,starts_at,ends_at,table_id,status,customer_request_id) VALUES('duplicate','store','line','unique','本人','Uone',2,'${start}','2027-10-01T05:00:00Z','table2','confirmed','request_direct')`,
      ),
    ).toThrow('customer_duplicate_booking');
    db.raw.exec("UPDATE rt_tables SET is_active=0 WHERE id='table2'");
    const other = await hold('request_three', 'two');
    expect(other.status).toBe(409);
    expect(() =>
      db.raw.exec(
        `INSERT INTO rt_reservations(id,store_id,source,customer_name,line_uid,guest_count,starts_at,ends_at,table_id,status) VALUES('external','store','manual','外部','other',2,'${start}','2027-10-01T05:00:00Z','table1','confirmed')`,
      ),
    ).toThrow(/(?:customer|restaurant)_table_conflict/);
  });
  it('未認証・対象外店舗・他人の予約・期限・版を拒否する', async () => {
    expect(
      (
        await app().request(
          '/api/liff/restaurant/availability?liffId=liff1&storeId=store&date=2027-10-01&guestCount=2',
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await request(
          '/api/liff/restaurant/availability?storeId=other&date=2027-10-01&guestCount=2',
        )
      ).status,
    ).toBe(404);
    const { data } = await read(await hold());
    expect(
      (
        await request(
          `/api/liff/restaurant/reservations/${data.id}/confirm`,
          { expectedVersion: 1 },
          'two',
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(`/api/liff/restaurant/reservations/${data.id}/confirm`, {
          expectedVersion: 2,
        })
      ).status,
    ).toBe(409);
    db.raw
      .prepare(
        "UPDATE rt_reservations SET hold_expires_at='2000-01-01' WHERE id=?",
      )
      .run(data.id);
    expect(
      (
        await request(`/api/liff/restaurant/reservations/${data.id}/confirm`, {
          expectedVersion: 1,
        })
      ).status,
    ).toBe(409);
  });
  it('営業時間外・臨時休業・貸切・席待ちの仮押さえ・LINE枠0を反映する', async () => {
    const store = {
      id: 'store',
      name: '店',
      timezone: 'Asia/Tokyo',
      line_account_id: 'a1',
      tenant_id: 't1',
    };
    expect(
      (await customerAvailability(db.db, store, '2027-10-01', 2))!.data
        .slots[0]!.available,
    ).toBe(true);
    expect(
      (
        await request('/api/liff/restaurant/holds', {
          storeId: 'store',
          startsAt: '2027-10-01T01:00:00Z',
          guestCount: 2,
          requestId: 'request_wrong',
        })
      ).status,
    ).toBe(409);
    db.raw
      .prepare(
        `INSERT INTO rt_closures(id,store_id,start_date,end_date,all_day,kind,table_ids_json,periods_json) VALUES('c','store','2027-10-01','2027-10-01',1,'private_event','[]',?)`,
      )
      .run(
        JSON.stringify([
          { startsAt: '2027-09-30T15:00:00Z', endsAt: '2027-10-01T15:00:00Z' },
        ]),
      );
    expect((await hold()).status).toBe(409);
    db.raw.exec(
      "UPDATE rt_closures SET archived_at=datetime('now'); INSERT INTO rt_inventory_slots(id,store_id,starts_at,total_capacity,line_capacity) VALUES('slot','store','2027-10-01T03:00:00Z',8,0)",
    );
    expect((await hold()).status).toBe(409);
  });
  it('席待ちの招待は空席として返さず、期限切れで戻す', async () => {
    db.raw.exec("UPDATE rt_tables SET is_active=0 WHERE id='table2'");
    db.raw
      .prepare(
        "INSERT INTO rt_seat_waitlist(id,store_id,starts_at,ends_at,guest_count,customer_name,line_uid,identity_key,status,table_id,hold_expires_at) VALUES('waiting','store',?,'2027-10-01T05:00:00Z',2,'待つ人','Uwait','wait','invited','table1',datetime('now','+30 minutes'))",
      )
      .run(start);
    expect((await hold()).status).toBe(409);
    db.raw.exec("UPDATE rt_seat_waitlist SET hold_expires_at='2000-01-01'");
    expect((await hold()).status).toBe(201);
  });
  it('締切後の変更・取消、偽のaudと期限切れの本人トークンを拒否する', async () => {
    const { data } = await read(await hold());
    await request(`/api/liff/restaurant/reservations/${data.id}/confirm`, {
      expectedVersion: 1,
    });
    db.raw.exec(
      "UPDATE booking_settings SET cancel_deadline_minutes_before=43200; UPDATE rt_reservations SET starts_at=datetime('now','+1 day'),ends_at=datetime('now','+1 day','+120 minutes')",
    );
    expect(
      (
        await request(`/api/liff/restaurant/reservations/${data.id}/cancel`, {
          expectedVersion: 2,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/api/liff/restaurant/reservations/${data.id}/reschedule`,
          { expectedVersion: 2, startsAt: start, guestCount: 2 },
        )
      ).status,
    ).toBe(403);
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ sub: 'Uone', aud: 'wrong', exp: Date.now() / 1000 + 60 }),
    );
    expect((await hold()).status).toBe(401);
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ sub: 'Uone', aud: 'login1', exp: 1 }),
    );
    expect((await hold()).status).toBe(401);
  });
  it('通知失敗で予約を戻さず、同じ鍵で再試行する', async () => {
    mocks.send.mockRejectedValueOnce(new Error('mock failure'));
    const { data } = await read(await hold());
    expect(
      (
        await request(`/api/liff/restaurant/reservations/${data.id}/confirm`, {
          expectedVersion: 1,
        })
      ).status,
    ).toBe(200);
    expect(db.raw.prepare('SELECT status FROM rt_reservations').get()).toEqual({
      status: 'confirmed',
    });
    db.raw.exec('UPDATE rt_customer_notice_outbox SET lease_until=NULL');
    expect(
      await processRestaurantCustomerNotices({ DB: db.db } as Env['Bindings']),
    ).toBe(1);
    expect(mocks.send.mock.calls[0]?.[1]).toEqual(
      mocks.send.mock.calls[1]?.[1],
    );
  });
});

it('停止したアカウントは本人確認と予約へ進めない', async () => {
  db.raw.exec("UPDATE line_accounts SET is_active=0 WHERE id='a1'");
  expect((await hold()).status).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
});
