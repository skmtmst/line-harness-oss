import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { webMeasurement } from './web-measurement.js';
import { conversions } from './conversions.js';

/*
 * #819: Web計測の公開口。
 * - 許可ドメイン以外からの成果は数えない(件数と最後の来た先だけ残す)
 * - 同意が無い送信は数えない
 * - 友だちと結び付かない成果は地点の「匿名を数える」設定のときだけ日別集計
 * - 取り消しは追記型の台帳(元の成果は消えない)
 */

const NOW = '2026-09-21T00:00:00+09:00';

function staff(
  id: string,
  tenantId: string,
  role: AuthenticatedStaff['role'] = 'owner',
  permissionKeys: string[] = [],
): AuthenticatedStaff {
  return { id, name: id, role, readOnly: false, tenantId, permissionKeys };
}

function app(current: AuthenticatedStaff | null) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    if (current) c.set('staff', current);
    await next();
  });
  instance.route('/', webMeasurement);
  instance.route('/', conversions);
  return instance;
}

function seed(testDb: SqliteD1): void {
  testDb.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1'), ('tenant-2', '統括2')`).run();
  for (const [id, tenant] of [['a1', 'tenant-1'], ['b1', 'tenant-2']] as const) {
    testDb.raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES (?, ?, ?, 'token', 'secret', 1, ?)`,
    ).run(id, `channel-${id}`, id, tenant);
  }
  testDb.raw.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('owner-1', 'owner-1', 'owner', 'key-1', 'tenant-1', 'all'),
            ('staff-1', 'staff-1', 'staff', 'key-2', 'tenant-1', 'all'),
            ('owner-2', 'owner-2', 'owner', 'key-3', 'tenant-2', 'all')`,
  ).run();
  // affiliates は既定でオフなので、公開口の検査を通るよう有効化する。
  testDb.raw.prepare(
    `INSERT INTO account_settings (id, line_account_id, key, value) VALUES ('s1', 'a1', 'feature.affiliates', 'true')`,
  ).run();
  // url_reach の成果地点。source モードで金額は申告値を採る。
  testDb.raw.prepare(
    `INSERT INTO conversion_points
      (id, name, event_type, measure_method, target_url, value_mode,
       line_account_id, tenant_id, status, count_anonymous, created_at)
     VALUES ('point-web', '購入完了', 'purchase', 'url_reach', 'https://example.com/thanks',
             'source', 'a1', 'tenant-1', 'active', 0, ?),
            ('point-anon', '到達(匿名可)', 'visit', 'url_reach', 'https://example.com/lp',
             'none', 'a1', 'tenant-1', 'active', 1, ?)`,
  ).run(NOW, NOW);
  testDb.raw.prepare(
    `INSERT INTO friends (id, line_user_id, display_name, line_account_id)
     VALUES ('f1', 'U-f1', '友だち1', 'a1')`,
  ).run();
  // 訪問者 → 友だちの結び付き。未結び付きの 'visitor-none' も置く。
  testDb.raw.prepare(
    `INSERT INTO site_visitors (id, line_account_id, friend_id, consent_state)
     VALUES ('a1:visitor-1', 'a1', 'f1', 'granted'),
            ('a1:visitor-none', 'a1', NULL, 'granted')`,
  ).run();
}

function seedSite(testDb: SqliteD1, host = 'example.com'): string {
  const siteId = 'site_'.padEnd(5, 'a').padEnd(37, 'a');
  testDb.raw.prepare(
    `INSERT INTO measurement_sites (id, line_account_id, label, created_at, updated_at)
     VALUES (?, 'a1', '公式ショップ', ?, ?)`,
  ).run(siteId, NOW, NOW);
  testDb.raw.prepare(
    `INSERT INTO measurement_site_domains (site_id, host, created_at) VALUES (?, ?, ?)`,
  ).run(siteId, host, NOW);
  return siteId;
}

function postConversion(db: SqliteD1, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return app(null).fetch(
    new Request('https://worker.example/api/public/web-conversions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    { DB: db.db } as unknown as Env['Bindings'],
  );
}

async function req(handler: Hono<Env>, db: SqliteD1, path: string, init?: RequestInit): Promise<Response> {
  return handler.fetch(
    new Request(`https://example.com${path}`, init),
    { DB: db.db } as unknown as Env['Bindings'],
  );
}

function eventCount(db: SqliteD1): number {
  // `.get() as T` の直後に `.n` を書くとトランスパイルでプロパティ参照が落ちるため、一度変数に置く。
  const row = db.raw.prepare('SELECT COUNT(*) AS n FROM conversion_events').get() as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

describe('POST /api/public/web-conversions', () => {
  it('許可ドメイン・同意・友だち結び付きの成果を数える', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const siteId = seedSite(testDb);
    const res = await postConversion(testDb, {
      siteId,
      visitorId: 'visitor-1',
      host: 'example.com',
      path: '/thanks',
      value: 1500,
      consent: 'granted',
    });
    expect(res.status).toBe(204);
    const row = testDb.raw.prepare(
      `SELECT friend_id, value_snapshot, conversion_point_id FROM conversion_events`,
    ).get() as { friend_id: string; value_snapshot: number; conversion_point_id: string };
    expect(row.friend_id).toBe('f1');
    expect(row.value_snapshot).toBe(1500);
    expect(row.conversion_point_id).toBe('point-web');
  });

  it('許可にないドメインは数えず、件数と最後の来た先だけ残す', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const siteId = seedSite(testDb);
    const res = await postConversion(testDb, {
      siteId, host: 'evil.example.org', path: '/thanks', consent: 'granted',
    });
    expect(res.status).toBe(204);
    expect(eventCount(testDb)).toBe(0);
    const rejection = testDb.raw.prepare(
      `SELECT host, rejected_count FROM measurement_domain_rejections WHERE site_id = ?`,
    ).get(siteId) as { host: string; rejected_count: number };
    expect(rejection).toEqual({ host: 'evil.example.org', rejected_count: 1 });
  });

  it('同意が無い送信は数えない', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const siteId = seedSite(testDb);
    await postConversion(testDb, {
      siteId, visitorId: 'visitor-1', host: 'example.com', path: '/thanks', consent: 'unset',
    });
    expect(eventCount(testDb)).toBe(0);
  });

  it('知らないサイトID・壊れた形は黙って捨てる', async () => {
    const testDb = createTestD1();
    seed(testDb);
    seedSite(testDb);
    const res = await postConversion(testDb, {
      siteId: 'site_0000000000000000000000000000ff', host: 'example.com', path: '/thanks', consent: 'granted',
    });
    expect(res.status).toBe(204);
    const bad = await postConversion(testDb, { siteId: 'not-a-site-id' });
    expect(bad.status).toBe(204);
    expect(eventCount(testDb)).toBe(0);
  });

  it('友だちと結び付かない成果は「匿名を数える」地点の日別集計にだけ入る', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const siteId = seedSite(testDb);
    // point-web は匿名を数えない → 何も残らない
    await postConversion(testDb, {
      siteId, visitorId: 'visitor-none', host: 'example.com', path: '/thanks', consent: 'granted',
    });
    expect(eventCount(testDb)).toBe(0);
    expect(
      testDb.raw.prepare('SELECT COUNT(*) AS n FROM conversion_anonymous_days').get() as { n: number },
    ).toEqual({ n: 0 });
    // point-anon は匿名を数える → 日別の合計へ
    await postConversion(testDb, {
      siteId, visitorId: 'visitor-none', host: 'example.com', path: '/lp', consent: 'granted',
    });
    const day = testDb.raw.prepare(
      `SELECT conversion_point_id, anonymous_count FROM conversion_anonymous_days`,
    ).get() as { conversion_point_id: string; anonymous_count: number };
    expect(day.conversion_point_id).toBe('point-anon');
    expect(day.anonymous_count).toBe(1);
    expect(eventCount(testDb)).toBe(0);
  });

  it('sourceEventId の再送は1件に潰れる', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const siteId = seedSite(testDb);
    const body = {
      siteId, visitorId: 'visitor-1', host: 'example.com', path: '/thanks',
      value: 500, consent: 'granted', sourceEventId: 'ext-1',
    };
    await postConversion(testDb, body);
    await postConversion(testDb, body);
    expect(eventCount(testDb)).toBe(1);
  });

  it('Origin ヘッダのドメインも許可判定に使う', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const siteId = seedSite(testDb);
    const res = await postConversion(
      testDb,
      { siteId, visitorId: 'visitor-1', path: '/thanks', consent: 'granted' },
      { Origin: 'https://example.com' },
    );
    expect(res.status).toBe(204);
    expect(eventCount(testDb)).toBe(1);
  });
});

describe('計測サイトの管理口', () => {
  it('GET はサイトと許可ドメイン・拒否数を返す', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const siteId = seedSite(testDb);
    await postConversion(testDb, { siteId, host: 'bad.example.org', path: '/thanks', consent: 'granted' });
    const res = await req(app(staff('owner-1', 'tenant-1')), testDb, '/api/measurement-sites?account_id=a1');
    expect(res.status).toBe(200);
    const body = await res.json() as { success: true; data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(siteId);
    expect(body.data[0].domains).toEqual(['example.com']);
    expect(body.data[0].rejectedCount).toBe(1);
    expect(body.data[0].lastRejectedHost).toBe('bad.example.org');
  });

  it('別統括のアカウントは指定できない', async () => {
    const testDb = createTestD1();
    seed(testDb);
    seedSite(testDb);
    const res = await req(app(staff('owner-2', 'tenant-2')), testDb, '/api/measurement-sites?account_id=a1');
    expect(res.status).toBe(400);
  });

  it('POST は owner/admin だけ。作成したサイトが一覧に出る', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const denied = await req(app(staff('staff-1', 'tenant-1', 'staff', ['/conversions'])), testDb, '/api/measurement-sites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'a1', label: 'LP', domains: ['lp.example.com'] }),
    });
    expect(denied.status).toBe(403);
    const res = await req(app(staff('owner-1', 'tenant-1')), testDb, '/api/measurement-sites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'a1', label: 'LP', domains: ['https://lp.example.com/'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { id: string; domains: string[] } };
    expect(body.data.id).toMatch(/^site_[a-f0-9]{32}$/);
    expect(body.data.domains).toEqual(['lp.example.com']);
  });

  it('PATCH で許可ドメインを差し替えられる', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const siteId = seedSite(testDb);
    const res = await req(app(staff('owner-1', 'tenant-1')), testDb, `/api/measurement-sites/${siteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: ['new.example.com'] }),
    });
    expect(res.status).toBe(200);
    const hosts = testDb.raw.prepare(
      'SELECT host FROM measurement_site_domains WHERE site_id = ?',
    ).all(siteId) as Array<{ host: string }>;
    expect(hosts.map((h) => h.host)).toEqual(['new.example.com']);
    // 差し替え後は旧ドメインからの送信を数えない
    await postConversion(testDb, { siteId, host: 'example.com', path: '/thanks', consent: 'granted' });
    expect(eventCount(testDb)).toBe(0);
  });
});

describe('成果の取消・取消の取消', () => {
  async function seedEvent(testDb: SqliteD1): Promise<string> {
    const siteId = seedSite(testDb);
    await postConversion(testDb, {
      siteId, visitorId: 'visitor-1', host: 'example.com', path: '/thanks', value: 800, consent: 'granted',
    });
    return (testDb.raw.prepare('SELECT id FROM conversion_events').get() as { id: string }).id;
  }

  it('理由つきで取り消し、履歴が残り、元の成果は消えない', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const eventId = await seedEvent(testDb);
    const res = await req(app(staff('owner-1', 'tenant-1')), testDb, `/api/conversions/events/${eventId}/reversals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'reverse', reason: '重複して届いたため' }),
    });
    expect(res.status).toBe(200);
    // 閲覧は機能の「見る」権限があればよい（staff でも履歴を読める）
    const history = await req(
      app(staff('staff-1', 'tenant-1', 'staff', ['/conversions'])),
      testDb,
      `/api/conversions/events/${eventId}/reversals`,
    );
    expect(history.status).toBe(200);
    const body = await history.json() as { data: Array<{ kind: string; reason: string }> };
    expect(body.data[0]).toMatchObject({ kind: 'reverse', reason: '重複して届いたため' });
    expect(eventCount(testDb)).toBe(1);
  });

  it('二重取消は409、取消を戻すと再び取り消せる', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const eventId = await seedEvent(testDb);
    const reverse = () => req(app(staff('owner-1', 'tenant-1')), testDb, `/api/conversions/events/${eventId}/reversals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'reverse', reason: '取り消し' }),
    });
    expect((await reverse()).status).toBe(200);
    expect((await reverse()).status).toBe(409);
    const restore = await req(app(staff('owner-1', 'tenant-1')), testDb, `/api/conversions/events/${eventId}/reversals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'restore', reason: '確認したら正しかった' }),
    });
    expect(restore.status).toBe(200);
    expect((await reverse()).status).toBe(200);
  });

  it('staff は取り消せない・理由なしは400', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const eventId = await seedEvent(testDb);
    const denied = await req(app(staff('staff-1', 'tenant-1', 'staff', ['/conversions'])), testDb, `/api/conversions/events/${eventId}/reversals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'reverse', reason: 'x' }),
    });
    expect(denied.status).toBe(403);
    const noReason = await req(app(staff('owner-1', 'tenant-1')), testDb, `/api/conversions/events/${eventId}/reversals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'reverse', reason: '  ' }),
    });
    expect(noReason.status).toBe(400);
  });
});
