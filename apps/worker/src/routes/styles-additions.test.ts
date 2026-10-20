import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import {
  ACCOUNT_STYLES,
  findUnsupportedInterpolations,
} from '@line-crm/shared';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { styles } from './styles.js';
import { hqTemplates } from './hq-templates.js';
import type { Env } from '../worker-env.js';
import { permissionForApiPath } from '../middleware/auth.js';
import * as googleCalendar from '../features/booking/booking-calendar-sync.js';
import { readWindow, instant } from '../services/style-analytics.js';
import {
  initializeAccountStyle,
  standardStarter,
} from '../services/style-setup.js';
import { templateSamples } from '../services/style-template-samples.js';
import {
  openSeatTables,
  openSeatTablePeriods,
} from '../services/restaurant-closures.js';

vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: async (_db: unknown, _s: unknown, ids: string[]) =>
    ids.every((id) => id === 'a'),
}));
let sql: ReturnType<typeof createTestD1>,
  app: Hono<Env>,
  actor: Env['Variables']['staff'];
const base = '/api/dashboard/style';
async function request(path: string, method = 'GET', body?: unknown) {
  const r = await app.request(
    path,
    {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    {
      DB: sql.db,
      RESTAURANT_TEST_ENABLED: 'true',
      DEPLOY_ENV: 'test',
      IMAGES: { head: vi.fn(), get: vi.fn(), put: vi.fn(), delete: vi.fn() },
    } as unknown as Env['Bindings'],
  );
  return { status: r.status, body: (await r.json()) as any };
}
beforeEach(async () => {
  sql = createTestD1({ foreignKeys: true, now: () => new Date() });
  sql.raw
    .exec(`INSERT INTO tenants(id,name,feature_packs) VALUES('t','本部','["restaurant"]');
    INSERT INTO line_accounts(id,tenant_id,channel_id,name,channel_access_token,channel_secret) VALUES('a','t','a','店A','fixture','fixture'),('b','t','b','店B','fixture','fixture');
    INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('owner','店長','owner','fixture','t');
    INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES('f','Uf','a','花子');
    INSERT INTO staff(id,line_account_id,name,display_name,staff_member_id) VALUES('s','a','担当A','担当A','owner'),('s2','a','担当B','担当B',NULL),('foreign','b','他店','他店',NULL);
    INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price) VALUES('m','a','面談',60,5000);
    INSERT INTO staff_menus(staff_id,menu_id,is_offered) VALUES('s','m',1);
    INSERT INTO booking_settings(id,line_account_id,business_hours_configured,cutoff_minutes_before) VALUES('settings','a',1,0);
    INSERT INTO booking_business_hours(id,booking_settings_id,weekday,start_time,end_time) VALUES('h','settings',4,'09:00','18:00');
    INSERT INTO staff_availability_rules(id,staff_id,weekday,start_time,end_time) VALUES('rule','s',4,'09:00','18:00');`);
  await initializeAccountStyle(sql.db, 'a', 't', 'owner');
  actor = {
    id: 'owner',
    name: '店長',
    tenantId: 't',
    role: 'owner',
    readOnly: false,
  } as Env['Variables']['staff'];
  app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', actor);
    await next();
  });
  app.route('/', styles);
  app.route('/', hqTemplates);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-15T03:00:00Z'));
});
afterEach(() => {
  vi.restoreAllMocks();
  sql.raw.close();
  vi.useRealTimers();
});

describe('template samples', () => {
  test.each(ACCOUNT_STYLES)(
    '%s returns supported placeholders and its exact starter samples',
    async (style) => {
      const result = await request(
        `${base}/template-samples?account_id=a&style=${style}`,
      );
      expect(result.status).toBe(200);
      expect(result.body.data.items.length).toBe(
        15 +
          {
            standard: 0,
            ec: 2,
            restaurant: 3,
            salon: 2,
            consult: 3,
            lesson: 3,
          }[style],
      );
      for (const item of result.body.data.items) {
        expect(findUnsupportedInterpolations(item.text)).toEqual([]);
        expect(item.placeholders).toEqual(
          expect.arrayContaining([
            {
              token: '{{account.name}}',
              label: '店名',
              requiresConfiguration: false,
            },
          ]),
        );
        if (!['standard', 'ec'].includes(style)) expect(standardStarter(style).items).toContainEqual(item.starterItem);
        expect(item.hqDefinition.template.messageContent).toBe(
          JSON.stringify({ text: item.text }),
        );
      }
      for (const item of standardStarter(style).items.filter(i => i.key.startsWith('sample-'))) expect(result.body.data.items.map((s: {starterItem: unknown}) => s.starterItem)).toContainEqual(item);
      expect(
        result.body.data.items.every(
          (s: any) => s.category === 'common' || s.category === style,
        ),
      ).toBe(true);
      expect(
        sql.raw.prepare('SELECT count(*) n FROM messages_log').get(),
      ).toEqual({ n: 0 });
    },
  );
  test('catalog checks account visibility, role and HQ scope; invalid styles are rejected', async () => {
    expect(permissionForApiPath(base + '/template-samples')).toBe('/templates');
    expect(
      (await request(`${base}/template-samples?account_id=b&style=salon`))
        .status,
    ).toBe(404);
    expect(
      (await request(`${base}/template-samples?account_id=a&style=wrong`))
        .status,
    ).toBe(400);
    actor.role = 'staff';
    actor.permissionKeys = [];
    expect(
      (await request(`${base}/template-samples?account_id=a&style=salon`))
        .status,
    ).toBe(403);
    actor.viewPermissionKeys = ['/templates'];
    actor.readOnly = true;
    expect(
      (await request(`${base}/template-samples?account_id=a&style=salon`))
        .status,
    ).toBe(200);
    expect(
      (await request('/api/hq/style-template-samples?style=salon')).status,
    ).toBe(403);
    actor.role = 'owner';
    sql.raw.exec(
      "UPDATE staff_members SET account_scope='accounts' WHERE id='owner'",
    );
    expect(
      (await request('/api/hq/style-template-samples?style=salon')).status,
    ).toBe(403);
  });
  test('setup inserts the full catalog once, keeps existing choices, and later content adds nothing', async () => {
    const before = sql.raw.prepare('SELECT count(*) n FROM templates').get();
    let r = await request(base + '?account_id=a', 'PUT', {
      expectedVersion: 1,
      style: 'salon',
      answers: { content: { mode: 'later' } },
    });
    expect(r.status).toBe(200);
    expect(sql.raw.prepare('SELECT count(*) n FROM templates').get()).toEqual(
      before,
    );
    const key = templateSamples('salon')[0].starterItem.key;
    const existing = sql.raw
      .prepare('SELECT id FROM templates LIMIT 1')
      .get() as { id: string };
    r = await request(base + '?account_id=a', 'PUT', {
      expectedVersion: 2,
      answers: { content: { mode: 'configured', value: true } },
      choices: { [key]: { mode: 'existing', resourceId: existing.id } },
    });
    expect(r.status).toBe(200);
    expect(
      r.body.data.inserted.filter((i: any) => i.kind === 'template'),
    ).toHaveLength(13);
    expect(r.body.data.inserted.find((i: any) => i.key === key)).toMatchObject({
      id: existing.id,
      isSample: false,
    });
    const templates = sql.raw
      .prepare('SELECT * FROM templates ORDER BY id')
      .all();
    expect(
      (await request(base + '?account_id=a', 'PUT', { expectedVersion: 3 }))
        .body.data.inserted,
    ).toEqual([]);
    expect(
      sql.raw.prepare('SELECT * FROM templates ORDER BY id').all(),
    ).toEqual(templates);
    expect(
      sql.raw.prepare('SELECT count(*) n FROM messages_log').get(),
    ).toEqual({ n: 0 });
  });
  test('HQ uses the same samples, saves edits and redistributes through existing preflight/overwrite', async () => {
    const catalog = await request(
      '/api/hq/style-template-samples?style=consult',
    );
    expect(catalog.status).toBe(200);
    expect(catalog.body.data.items).toEqual(templateSamples('consult'));
    const sample = catalog.body.data.items.find(
      (s: any) => s.key === 'online-url',
    );
    const saved = await request('/api/hq/templates', 'POST', {
      type: 'template',
      name: sample.name,
      definition: sample.hqDefinition,
      requestId: 'style-sample-create-001',
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    const id = saved.body.data.template.id;
    async function distribute(mode = 'create') {
      const p = await request(`/api/hq/templates/${id}/preflight`, 'POST', {
        accountIds: ['b'],
      });
      expect(p.status, JSON.stringify(p.body)).toBe(200);
      const result = await request(
        `/api/hq/templates/${id}/distribute`,
        'POST',
        {
          preflightId: p.body.data.preflightId,
          resolutions: p.body.data.stores.flatMap((s: any) =>
            s.items.map((i: any) => ({
              accountId: s.accountId,
              sourceId: i.sourceId,
              mode,
            })),
          ),
        },
      );
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(
        result.body.data.stores[0].status,
        JSON.stringify(result.body),
      ).toBe('succeeded');
    }
    await distribute();
    let row = sql.raw
      .prepare(
        "SELECT id,message_content FROM templates WHERE line_account_id='b'",
      )
      .get() as any;
    expect(JSON.parse(row.message_content)).toEqual({ text: sample.text });
    const originalId = row.id;
    const definition = structuredClone(sample.hqDefinition);
    definition.template.messageContent = JSON.stringify({
      text: sample.text + '\nお待ちしています。',
    });
    expect(
      (
        await request(`/api/hq/templates/${id}`, 'PATCH', {
          type: 'template',
          name: sample.name,
          definition,
          expectedRevision: 2,
        })
      ).status,
    ).toBe(200);
    await distribute('overwrite');
    row = sql.raw
      .prepare(
        "SELECT id,message_content FROM templates WHERE line_account_id='b'",
      )
      .get();
    expect(row.id).toBe(originalId);
    expect(JSON.parse(row.message_content).text).toContain(
      'お待ちしています。',
    );
    expect(
      sql.raw.prepare('SELECT count(*) n FROM messages_log').get(),
    ).toEqual({ n: 0 });
    expect(sql.raw.pragma('foreign_key_check')).toEqual([]);
  });
});

function book(id: string, start: string, end: string, staff = 's') {
  sql.raw
    .prepare(
      "INSERT INTO bookings(id,line_account_id,friend_id,staff_id,menu_id,starts_at,ends_at,block_ends_at,status,price_at_booking,requested_at) VALUES(?,'a','f',?,'m',?,?,?,'confirmed',5000,'2026-10-01T00:00:00Z')",
    )
    .run(id, staff, start, end, end);
}
describe('range and schedule', () => {
  test('Google busy times block availability and connection failure is unavailable rather than zero', async () => {
    const busy = vi
      .spyOn(googleCalendar, 'getStaffGoogleBusy')
      .mockResolvedValue([
        { start: '2026-10-15T04:00:00Z', end: '2026-10-15T06:00:00Z' },
      ]);
    let r = await request(
      `${base}/schedule?account_id=a&style=salon&staff_id=s`,
    );
    expect(r.status).toBe(200);
    expect(busy).toHaveBeenCalledWith(
      sql.db,
      { email: undefined, privateKey: undefined },
      expect.objectContaining({ lineAccountId: 'a', staffId: 's' }),
    );
    expect(r.body.data.availability.slots.length).toBeGreaterThan(0);
    for (const slot of r.body.data.availability.slots)
      expect(
        instant(slot.startsAt) >= instant('2026-10-15T06:00:00Z') ||
          instant(slot.endsAt) <= instant('2026-10-15T04:00:00Z'),
      ).toBe(true);
    busy.mockRejectedValue(new Error('fixture-unavailable'));
    r = await request(`${base}/schedule?account_id=a&style=salon&staff_id=s`);
    expect(r.body.data.availability).toMatchObject({
      status: 'unavailable',
      reason: 'calendar_unavailable',
      slots: [],
    });
  });
  test.each([
    ['today', '2026-10-15', '2026-10-16'],
    ['week', '2026-10-12', '2026-10-19'],
    ['month', '2026-10-01', '2026-11-01'],
  ])(
    '%s calendar period is half open in the account timezone',
    (range, from, to) => {
      expect(
        readWindow({ range, date: '2026-10-15' }, 'Asia/Tokyo', Date.now()),
      ).toMatchObject({ range, fromDate: from, toDate: to });
    },
  );
  test('leap month, Sunday, year boundaries, DST and obsolete ranges', () => {
    expect(
      readWindow(
        { range: 'month', date: '2028-02-29' },
        'Asia/Tokyo',
        Date.now(),
      ).toDate,
    ).toBe('2028-03-01');
    expect(
      readWindow(
        { range: 'week', date: '2027-01-03' },
        'Asia/Tokyo',
        Date.now(),
      ).fromDate,
    ).toBe('2026-12-28');
    const w = readWindow(
      { range: 'week', date: '2026-03-08' },
      'America/New_York',
      Date.now(),
    );
    expect(instant(w.to) - instant(w.from)).toBe(167 * 3600000);
    for (const range of ['tomorrow', 'future', 'bad'])
      expect(() => readWindow({ range }, 'Asia/Tokyo', Date.now())).toThrow();
  });
  test.each(['board', 'list', 'calendar'])(
    '%s returns identical real bookings, crossing midnight, closures and verified free slots',
    async (display) => {
      book('night', '2026-10-14T14:30:00Z', '2026-10-14T16:00:00Z');
      book('booked', '2026-10-15T04:00:00Z', '2026-10-15T05:00:00Z');
      book('other', '2026-10-15T04:00:00Z', '2026-10-15T05:00:00Z', 's2');
      sql.raw.exec(
        "INSERT INTO booking_availability_exceptions(id,line_account_id,scope_kind,scope_id,date_from,date_to,kind,hours_json) VALUES('short','a','staff','s','2026-10-15','2026-10-15','custom_hours','[{\"start\":\"09:00\",\"end\":\"16:00\"}]')",
      );
      const r = await request(
        `${base}/schedule?account_id=a&style=salon&range=today&date=2026-10-15&display=${display}&staff_id=s`,
      );
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const d = r.body.data;
      expect(d).toMatchObject({ range: 'today', display, calendarView: 'day' });
      expect(d.entries.map((e: any) => e.booking.id)).toEqual([
        'night',
        'booked',
      ]);
      expect(d.columns.map((e: any) => e.id)).toEqual(['s']);
      expect(d.closures[0]).toMatchObject({
        id: 'short',
        target: 'staff',
        kind: 'custom_hours',
      });
      expect(d.availability.slots.length).toBeGreaterThan(0);
      for (const slot of d.availability.slots) {
        expect(slot.columnId).toBe('s');
        expect(instant(slot.endsAt)).toBeLessThanOrEqual(
          instant('2026-10-15T07:00:00Z'),
        );
        expect(
          instant(slot.startsAt) >= instant('2026-10-15T05:00:00Z') ||
            instant(slot.endsAt) <= instant('2026-10-15T04:00:00Z'),
        ).toBe(true);
      }
    },
  );
  test('summary and schedule use the same week and month boundaries; counts use visit date', async () => {
    book('inside', '2026-10-18T14:59:00Z', '2026-10-18T15:59:00Z');
    book('outside', '2026-10-18T15:00:00Z', '2026-10-18T16:00:00Z');
    for (const range of ['week', 'month']) {
      const summary = await request(
        `${base}/summary?account_id=a&style=salon&range=${range}`,
      );
      const calendar = await request(
        `${base}/schedule?account_id=a&style=salon&range=${range}&display=calendar`,
      );
      expect(summary.status).toBe(200);
      expect(calendar.status).toBe(200);
      expect(calendar.body.data.from).toBe(summary.body.data.from);
      expect(calendar.body.data.to).toBe(summary.body.data.to);
      expect(calendar.body.data.days).toHaveLength(range === 'week' ? 7 : 31);
      if (range === 'week')
        expect(summary.body.data.items.map((b: any) => b.id)).toEqual([
          'inside',
        ]);
    }
  });
  test('consult staff cannot read another person or account; closed days keep existing bookings', async () => {
    actor.role = 'staff';
    actor.permissionKeys = ['/booking/bookings'];
    expect(
      (await request(`${base}/schedule?account_id=a&style=consult&staff_id=s2`))
        .status,
    ).toBe(403);
    expect(
      (await request(`${base}/schedule?account_id=b&style=consult`)).status,
    ).toBe(404);
    book('existing', '2026-10-15T04:00:00Z', '2026-10-15T05:00:00Z');
    sql.raw.exec(
      "INSERT INTO booking_availability_exceptions(id,line_account_id,scope_kind,date_from,date_to,kind) VALUES('closed','a','store','2026-10-15','2026-10-15','closed')",
    );
    const r = await request(`${base}/schedule?account_id=a&style=consult`);
    expect(r.status).toBe(200);
    expect(r.body.data.entries).toHaveLength(1);
    expect(r.body.data.availability.slots).toEqual([]);
    expect(r.body.data.availability.closedDates).toEqual(['2026-10-15']);
    expect(
      sql.raw.prepare("SELECT status FROM bookings WHERE id='existing'").get(),
    ).toEqual({ status: 'confirmed' });
  });
  test('classes with no bookings are shown and split capacity includes waiting offers', async () => {
    sql.raw
      .exec(`INSERT INTO events(id,line_account_id,name,is_published) VALUES('e','a','ヨガ',1);
      INSERT INTO event_slots(id,event_id,starts_at,ends_at,capacity,classroom_capacity,online_capacity,instructor_id) VALUES('slot','e','2026-10-15T04:00:00Z','2026-10-15T05:00:00Z',10,2,5,'s');
      INSERT INTO event_waitlist(id,event_id,slot_id,friend_id,line_account_id,party_size,status,participation_mode,identity_key,created_at,updated_at) VALUES('wait','e','slot','f','a',2,'offered','classroom','friend:f','2026-10-01','2026-10-01');`);
    const r = await request(
      `${base}/schedule?account_id=a&style=lesson&range=week&display=calendar&staff_id=s`,
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.entries).toMatchObject([
      { id: 'class:slot', kind: 'class', title: 'ヨガ', columnIds: ['s'] },
    ]);
    expect(r.body.data.availability.slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mode: 'classroom', remaining: 0 }),
        expect.objectContaining({ mode: 'online', remaining: 5 }),
      ]),
    );
  });
  test('restaurant table availability agrees with the existing check and respects closure and linked tables', async () => {
    sql.raw
      .exec(`INSERT INTO rt_organizations(id,account_id,name) VALUES('org','a','店');
      INSERT INTO rt_stores(id,organization_id,line_account_id,name,code) VALUES('store','org','a','店','STORE');
      INSERT INTO rt_tables(id,store_id,code,label,seat_type,min_capacity,max_capacity) VALUES('table','store','T','T','table',1,4);
      INSERT INTO rt_opening_hours_settings(store_id,updated_by,hours_json) VALUES('store','owner','[{"weekday":4,"periods":[{"opensAt":"12:00","closesAt":"18:00"}]}]');
      INSERT INTO rt_reservations(id,store_id,source,customer_name,guest_count,starts_at,ends_at,table_id,status,staff_id) VALUES('r','store','phone','花子',2,'2026-10-15T04:00:00Z','2026-10-15T05:00:00Z','table','confirmed','s');
      INSERT INTO rt_closures(id,store_id,start_date,end_date,all_day,start_time,end_time,kind,periods_json) VALUES('c','store','2026-10-15','2026-10-15',0,'16:00','17:00','temporary_closed','[{"startsAt":"2026-10-15T07:00:00Z","endsAt":"2026-10-15T08:00:00Z"}]');`);
    const periods = [
      { startsAt: '2026-10-15T04:00:00Z', endsAt: '2026-10-15T05:00:00Z' },
      { startsAt: '2026-10-15T05:00:00Z', endsAt: '2026-10-15T06:00:00Z' },
      { startsAt: '2026-10-15T07:00:00Z', endsAt: '2026-10-15T08:00:00Z' },
    ];
    const bulk = await openSeatTablePeriods(sql.db, 'store', periods, 2);
    for (const [index, period] of periods.entries())
      expect(bulk[index].tables.map((t) => t.id)).toEqual(
        (
          await openSeatTables(
            sql.db,
            'store',
            period.startsAt,
            period.endsAt,
            2,
          )
        ).map((t) => t.id),
      );
    const r = await request(
      `${base}/schedule?account_id=a&style=restaurant&range=today&display=board&axis=table&duration_minutes=60&guest_count=2`,
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.columns).toMatchObject([{ id: 'table', kind: 'table' }]);
    expect(r.body.data.entries[0].columnIds).toEqual(['table']);
    expect(r.body.data.closures[0].id).toBe('c');
    expect(r.body.data.availability.slots.length).toBeGreaterThan(0);
    expect(
      r.body.data.availability.slots.some(
        (s: any) => instant(s.startsAt) === instant(periods[0].startsAt),
      ),
    ).toBe(false);
    const prepare = vi.spyOn(sql.db, 'prepare');
    const month = await request(
      `${base}/schedule?account_id=a&style=restaurant&range=month&display=calendar`,
    );
    expect(month.status).toBe(200);
    expect(month.body.data.days).toHaveLength(31);
    expect(prepare.mock.calls.length).toBeLessThan(30);
    expect(
      sql.raw.prepare('SELECT count(*) n FROM style_analytics_results').get(),
    ).toEqual({ n: 0 });
    prepare.mockRestore();
  });
  test('bulk seat checks preserve joined-table capacity and expiring invitations with a default end', async () => {
    sql.raw
      .exec(`INSERT INTO rt_organizations(id,account_id,name) VALUES('org','a','店');
      INSERT INTO rt_stores(id,organization_id,line_account_id,name,code) VALUES('store','org','a','店','STORE');
      INSERT INTO rt_tables(id,store_id,code,label,seat_type,min_capacity,max_capacity,join_group) VALUES('a','store','A','A','table',1,2,'join'),('b','store','B','B','table',1,2,'join');
      INSERT INTO rt_seat_waitlist(id,store_id,starts_at,guest_count,customer_name,identity_key,status,table_id,hold_expires_at) VALUES('w','store','2026-10-15T05:00:00Z',2,'太郎','friend:f','invited','b','2026-10-15T06:00:00Z');`);
    const periods = [
      { startsAt: '2026-10-15T05:00:00Z', endsAt: '2026-10-15T06:00:00Z' },
    ];
    expect(
      (await openSeatTablePeriods(sql.db, 'store', periods, 3))[0].tables,
    ).toEqual([]);
    expect(
      await openSeatTables(
        sql.db,
        'store',
        periods[0].startsAt,
        periods[0].endsAt,
        3,
      ),
    ).toEqual([]);
    sql.raw.exec(
      "UPDATE rt_seat_waitlist SET hold_expires_at='2026-10-15T02:00:00Z' WHERE id='w'",
    );
    const free = (await openSeatTablePeriods(sql.db, 'store', periods, 3))[0]
      .tables;
    expect(free).toMatchObject([{ tableIds: ['a', 'b'], maxCapacity: 4 }]);
    sql.raw.exec("UPDATE rt_tables SET is_active=0 WHERE id='b'");
    expect(
      (await openSeatTablePeriods(sql.db, 'store', periods, 3))[0].tables,
    ).toEqual([]);
  });
  test('invalid display/range/foreign staff fails explicitly', async () => {
    for (const query of [
      'display=bad',
      'range=tomorrow',
      'calendar_view=bad',
      'range=week&calendar_view=month',
    ])
      expect(
        (await request(`${base}/schedule?account_id=a&style=salon&${query}`))
          .status,
      ).toBe(400);
    expect(
      (
        await request(
          `${base}/schedule?account_id=a&style=salon&staff_id=foreign`,
        )
      ).status,
    ).toBe(404);
  });
});
