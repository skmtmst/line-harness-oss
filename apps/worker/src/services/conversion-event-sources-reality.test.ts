/*
 * 6起点が「実際に1件数えられる」ことを実DBで見る (#648 / N-253)。
 *
 * この票の芯は「画面で6種類の起点を選べるのに、実質1種類しか自動計測
 * されない」。したがって **繋いだことを見ても足りない**。本物の
 * bootstrap.sql を better-sqlite3 に流し、本物の route / 本物の
 * trackConversion を通したうえで、`conversion_events` の行が実際に
 * 1件増えることを起点ごとに見る。
 *
 * 差し替えるのは外へ出るものだけ (LINE送信・本人確認・Google Calendar・
 * 空き枠計算)。成果を数える経路そのものは1行も差し替えていない。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Env } from '../index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP = readFileSync(
  join(HERE, '..', '..', '..', '..', 'packages', 'db', 'bootstrap.sql'),
  'utf8',
);

/** LINE の userId は `U` + 16進32桁。EC の口はこの形を検査する。 */
const LINE_USER_ID = 'U0123456789abcdef0123456789abcdef';

// ---- 外へ出るものだけ差し替える -------------------------------------------

vi.mock('../services/liff-auth.js', () => ({
  verifyCallerLineUserId: vi.fn(async () => LINE_USER_ID),
  verifyCallerLineIdentity: vi.fn(async () => ({
    lineUserId: LINE_USER_ID,
    lineAccountId: 'account-a',
  })),
}));

vi.mock('../services/line-proxy-send.js', () => ({
  pushViaHarnessProxy: vi.fn(async () => undefined),
}));

vi.mock('../services/local-line-proxy.js', () => ({
  dispatchLineProxyLocally: vi.fn(async () => new Response(null, { status: 200 })),
}));

vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
  getVisibleLineAccountScope: vi.fn(async () => ({
    allowedAccountIds: ['account-a'],
    canSeeUnassigned: true,
  })),
}));

vi.mock('../services/booking-notifier.js', () => ({
  sendBookingNotification: vi.fn(async () => ({ ok: true })),
  notifyForBooking: vi.fn(async () => undefined),
}));

/** 空き枠計算だけ置き換える。店舗タイムゾーンの解決は本物のまま。 */
const availabilityMocks = { getAvailability: vi.fn() };
vi.mock('../services/availability.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/availability.js')>()),
  ...availabilityMocks,
}));

vi.mock('../services/booking-calendar-sync.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/booking-calendar-sync.js')>()),
  syncConfirmedBookingToGoogle: vi.fn(async () => ({ synced: false })),
  removeBookingFromGoogle: vi.fn(async () => undefined),
}));

const { default: booking } = await import('../routes/booking.js');
const { forms } = await import('../routes/forms.js');
const { webinarRoutes } = await import('../routes/webinars.js');
const { trackedLinks } = await import('../routes/tracked-links.js');
const { ecIntegrations } = await import('../routes/ec-integrations.js');
const { attachTagAndFireSideEffects } = await import('./friend-tag-attach.js');
const { recordConversionSourceEvent } = await import('./conversion-event-sources.js');

// ---- 実 SQLite を D1 の形にかぶせる ----------------------------------------

function asD1(sqlite: Database.Database): D1Database {
  function call<T>(run: (...args: unknown[]) => T, params: unknown[]): T {
    try {
      return run(...params);
    } catch (error) {
      if (!/parameter/i.test(String((error as Error)?.message))) throw error;
      return run(Object.fromEntries(params.map((value, index) => [String(index + 1), value])));
    }
  }
  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      const bound = (params: unknown[]): D1PreparedStatement => ({
        bind: (...next: unknown[]) => bound(next),
        all: async <T>() => ({
          success: true,
          results: call((...a) => statement.all(...a), params) as T[],
          meta: {},
        }),
        first: async <T>() =>
          (call((...a) => statement.get(...a), params) as T | undefined) ?? null,
        run: async <T>() => {
          const changes = statement.reader
            ? (call((...a) => statement.all(...a), params) as unknown[]).length
            : call((...a) => statement.run(...a), params).changes;
          return { success: true, results: [], meta: { changes } } as T;
        },
        raw: async () => [],
      } as unknown as D1PreparedStatement);
      return bound([]);
    },
    async batch(statements: D1PreparedStatement[]) {
      const out = [];
      for (const statement of statements) out.push(await statement.run());
      return out;
    },
  };
  return db as unknown as D1Database;
}

/** waitUntil に積まれた仕事を最後まで走らせてから数える。 */
function makeExecCtx() {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => { pending.push(Promise.resolve(p)); },
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext;
  return {
    ctx,
    async drain() {
      // 積まれた仕事が更に積むことがあるので、空になるまで繰り返す。
      while (pending.length > 0) {
        const batch = pending.splice(0, pending.length);
        await Promise.allSettled(batch);
      }
    },
  };
}

let sqlite: Database.Database;
let db: D1Database;

const ECCUBE_SECRET = 'eccube-webhook-secret-0123456789abcdef';

function env(): Env['Bindings'] {
  return {
    DB: db,
    IMAGES: { put: vi.fn() } as unknown as R2Bucket,
    LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
    WORKER_URL: 'https://worker.example.test',
    ECCUBE_WEBHOOK_SECRET: ECCUBE_SECRET,
  } as unknown as Env['Bindings'];
}

/** 起点ごとに計測中の成果地点を1つ置く。 */
function addPoint(eventType: string, options: { targetUrl?: string } = {}): string {
  const id = `point-${eventType}`;
  sqlite
    .prepare(
      `INSERT INTO conversion_points
         (id, name, event_type, value, status, measure_method, target_url,
          count_repeat, line_account_id, deduplication_mode)
       VALUES (?, ?, ?, 1000, 'active', ?, ?, 1, 'account-a', 'every')`,
    )
    .run(
      id,
      `${eventType} の成果`,
      eventType,
      options.targetUrl ? 'url_reach' : 'webhook',
      options.targetUrl ?? null,
    );
  return id;
}

function countEvents(eventType: string): number {
  const row = sqlite
    .prepare(
      `SELECT COUNT(*) AS n FROM conversion_events
        WHERE conversion_point_id = ? AND friend_id = 'friend-1'`,
    )
    .get(`point-${eventType}`) as { n: number };
  return row.n;
}

beforeEach(() => {
  vi.clearAllMocks();
  sqlite = new Database(':memory:');
  // 参照整合性は本番の D1 と同じく既定で切る。EC の口は取り込みの途中で
  // 管理タグを付けに行くが、その tags 行はこの試験では作らない。
  sqlite.pragma('foreign_keys = OFF');
  sqlite.exec(BOOTSTRAP);
  sqlite.exec(`
    INSERT OR IGNORE INTO tenants (id, name) VALUES ('tenant-1', 'T1');
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, tenant_id, is_active)
    VALUES ('account-a', 'ch-a', 'A店', 'tok-a', 'sec-a', 'tenant-1', 1);
    INSERT INTO friends (id, line_user_id, line_account_id, display_name, is_following)
    VALUES ('friend-1', '${LINE_USER_ID}', 'account-a', '一郎', 1);
  `);
  db = asD1(sqlite);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })));
});

afterEach(() => {
  sqlite.close();
  vi.unstubAllGlobals();
});

// ---- 1. ページを見た (url_reach) -------------------------------------------

describe('起点1: ページを見た (url_reach)', () => {
  test('短縮リンクを踏むと成果が1件数えられる', async () => {
    addPoint('url_reach', { targetUrl: 'https://shop.example.test/lp' });
    sqlite
      .prepare(
        `INSERT INTO tracked_links (id, name, original_url, line_account_id, is_active)
         VALUES ('link-1', 'LP', 'https://shop.example.test/lp?utm=x', 'account-a', 1)`,
      )
      .run();

    const app = new Hono<Env>();
    app.route('/', trackedLinks);
    const exec = makeExecCtx();
    const res = await app.fetch(
      new Request('https://worker.example.test/t/link-1?f=friend-1', {
        headers: { 'user-agent': 'Mozilla/5.0' },
      }),
      env(),
      exec.ctx,
    );
    await exec.drain();

    expect(res.status).toBe(302);
    expect(countEvents('url_reach')).toBe(1);
  });
});

// ---- 2. タグが付いた (tag_added) -------------------------------------------

describe('起点2: タグが付いた (tag_added)', () => {
  test('新規付与で成果が1件数えられ、同じタグの再付与では増えない', async () => {
    addPoint('tag_added');
    sqlite.prepare(`INSERT INTO tags (id, name) VALUES ('tag-1', 'VIP')`).run();

    await attachTagAndFireSideEffects(db, 'friend-1', 'tag-1');
    expect(countEvents('tag_added')).toBe(1);

    await attachTagAndFireSideEffects(db, 'friend-1', 'tag-1');
    expect(countEvents('tag_added')).toBe(1);
  });
});

// ---- 3. 動画を見終えた (webinar_completed) ---------------------------------

describe('起点3: 動画を見終えた (webinar_completed)', () => {
  const SESSION_START = Math.floor(Date.UTC(2026, 6, 29, 11, 0) / 1000);

  function setupWebinar() {
    sqlite
      .prepare(
        `INSERT INTO webinars
           (id, account_id, title, slug, status, video_prefix, duration_seconds,
            schedule_json, created_at, updated_at)
         VALUES ('w1', 'account-a', 'テスト', 'test-webinar', 'active', 'webinars/test',
                 1000, '[{"type":"once","at":"2026-07-29T20:00:00+09:00"}]', 'x', 'x')`,
      )
      .run();
  }

  function heartbeat(positionSeconds: number) {
    const app = new Hono<Env>();
    app.route('/', webinarRoutes);
    const exec = makeExecCtx();
    return app
      .fetch(
        new Request('https://worker.example.test/api/liff/webinars/test-webinar/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer u' },
          body: JSON.stringify({ sessionStartAt: SESSION_START, positionSeconds }),
        }),
        env(),
        exec.ctx,
      )
      .then(async (res) => {
        await exec.drain();
        return res;
      });
  }

  test('視聴完了(90%到達)で成果が1件数えられ、同じ視聴の再送では増えない', async () => {
    addPoint('webinar_completed');
    setupWebinar();

    const half = await heartbeat(400);
    expect(half.status).toBe(200);
    // 90%に届かない位置では数えない。
    expect(countEvents('webinar_completed')).toBe(0);

    const done = await heartbeat(950);
    expect(done.status).toBe(200);
    expect(countEvents('webinar_completed')).toBe(1);

    await heartbeat(980);
    expect(countEvents('webinar_completed')).toBe(1);
  });
});

// ---- 4. フォームが送信された (form_submitted) -----------------------------

describe('起点4: フォームが送信された (form_submitted)', () => {
  const LAYOUT = JSON.stringify({
    sections: [{
      id: 's1',
      blocks: [{ id: 'b1', kind: 'input', type: 'text', name: 'full_name', label: 'お名前', required: true }],
    }],
    options: {},
  });

  function setupForm() {
    sqlite.exec(`
      INSERT INTO forms (id, name, fields, layout, save_to_metadata, is_active, submit_count)
      VALUES ('form-1', 'F', '[]', '${LAYOUT}', 0, 1, 0);
      INSERT INTO form_accounts (form_id, line_account_id) VALUES ('form-1', 'account-a');
    `);
  }

  function submit(key: string) {
    const app = new Hono<Env>();
    app.route('/', forms);
    const exec = makeExecCtx();
    return app
      .fetch(
        new Request('https://worker.example.test/api/forms/form-1/submit', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer u',
            'Idempotency-Key': key,
          },
          body: JSON.stringify({ data: { full_name: '山田' } }),
        }),
        env(),
        exec.ctx,
      )
      .then(async (res) => {
        await exec.drain();
        return res;
      });
  }

  test('回答の保存で成果が1件数えられ、同じキーの再送では増えない', async () => {
    addPoint('form_submitted');
    setupForm();

    const first = await submit('aaaaaaaa-1111-4333-8444-666666666666');
    expect(first.status).toBe(201);
    expect(countEvents('form_submitted')).toBe(1);

    await submit('aaaaaaaa-1111-4333-8444-666666666666');
    expect(countEvents('form_submitted')).toBe(1);
  });
});

// ---- 5. 予約が確定した (reservation_confirmed) ----------------------------

describe('起点5: 予約が確定した (reservation_confirmed)', () => {
  function setupMenuAndStaff() {
    sqlite.exec(`
      INSERT INTO menus (id, line_account_id, name, duration_minutes, buffer_after_minutes, base_price)
      VALUES ('menu-1', 'account-a', '施術', 60, 0, 8000);
      INSERT INTO staff (id, line_account_id, name, display_name)
      VALUES ('staff-1', 'account-a', '担当', '担当');
      INSERT INTO staff_menus (staff_id, menu_id, is_offered) VALUES ('staff-1', 'menu-1', 1);
    `);
  }

  function setupBooking(status: string) {
    setupMenuAndStaff();
    sqlite.exec(`
      INSERT INTO bookings
        (id, line_account_id, friend_id, staff_id, menu_id, starts_at, ends_at, block_ends_at,
         status, price_at_booking, requested_at)
      VALUES ('booking-1', 'account-a', 'friend-1', 'staff-1', 'menu-1',
              '2026-12-01T01:00:00.000Z', '2026-12-01T02:00:00.000Z', '2026-12-01T02:00:00.000Z',
              '${status}', 8000, '2026-11-01T00:00:00.000Z');
    `);
  }

  function app() {
    const a = new Hono<Env>();
    a.use('*', async (c, next) => {
      c.set('staff', { id: 'staff-1', name: '担当', role: 'owner', readOnly: false } as never);
      return next();
    });
    a.route('/', booking);
    return a;
  }

  function approve() {
    const exec = makeExecCtx();
    return app()
      .fetch(
        new Request(
          'https://worker.example.test/api/booking/admin/requests/booking-1?account_id=account-a',
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'approve' }),
          },
        ),
        env(),
        exec.ctx,
      )
      .then(async (res) => {
        await exec.drain();
        return res;
      });
  }

  const PROXY_START = '2027-06-01T01:00:00.000Z';

  function proxyCreate(key: string) {
    availabilityMocks.getAvailability.mockResolvedValue({
      by_staff: [{
        staff_id: 'staff-1',
        display_name: '担当',
        slots: [{
          date: '2027-06-01',
          start: '10:00',
          end: '11:00',
          timeZone: 'Asia/Tokyo',
          startUtc: PROXY_START,
          endUtc: '2027-06-01T02:00:00.000Z',
          capacity: 1,
          remaining: 1,
          state: 'available',
        }],
      }],
    });
    const exec = makeExecCtx();
    return app()
      .fetch(
        new Request('https://worker.example.test/api/booking/admin/bookings?account_id=account-a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
          body: JSON.stringify({
            friend_id: 'friend-1',
            menu_id: 'menu-1',
            staff_id: 'staff-1',
            starts_at: PROXY_START,
            send_line_confirmation: false,
          }),
        }),
        env(),
        exec.ctx,
      )
      .then(async (res) => {
        await exec.drain();
        return res;
      });
  }

  test('代理登録(入った時点で確定)でも成果が1件数えられる', async () => {
    addPoint('reservation_confirmed');
    setupMenuAndStaff();

    const res = await proxyCreate('bbbbbbbb-2222-4333-8444-777777777777');
    expect(res.status).toBe(201);
    expect(countEvents('reservation_confirmed')).toBe(1);
  });

  test('申込の承認で成果が1件数えられ、承認の再送では増えない', async () => {
    addPoint('reservation_confirmed');
    setupBooking('requested');

    const res = await approve();
    expect(res.status).toBe(200);
    expect(countEvents('reservation_confirmed')).toBe(1);

    // 2度目は状態遷移として弾かれる。数も増えない。
    const again = await approve();
    expect(again.status).toBe(409);
    expect(countEvents('reservation_confirmed')).toBe(1);
  });
});

// ---- 境界 (起点・アカウント・友だち) --------------------------------------

describe('境界: 起点・アカウント・友だちが合わないものは数えない', () => {
  beforeEach(() => {
    sqlite.exec(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, tenant_id, is_active)
      VALUES ('account-b', 'ch-b', 'B店', 'tok-b', 'sec-b', 'tenant-1', 1);
      INSERT INTO friends (id, line_user_id, line_account_id, display_name, is_following)
      VALUES ('friend-b', 'Ubbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'account-b', '別店の人', 1);
      INSERT INTO tags (id, name) VALUES ('tag-1', 'VIP');
    `);
  });

  test('別アカウントの地点は、同じ起点でも数えない', async () => {
    sqlite
      .prepare(
        `INSERT INTO conversion_points
           (id, name, event_type, value, status, measure_method, count_repeat, line_account_id)
         VALUES ('point-b', 'B店の成果', 'tag_added', 1000, 'active', 'webhook', 1, 'account-b')`,
      )
      .run();

    await attachTagAndFireSideEffects(db, 'friend-1', 'tag-1');

    const row = sqlite
      .prepare(`SELECT COUNT(*) AS n FROM conversion_events WHERE conversion_point_id = 'point-b'`)
      .get() as { n: number };
    expect(row.n).toBe(0);
  });

  test('別アカウントの友だちの出来事は、こちらの地点に入らない', async () => {
    addPoint('tag_added');

    await attachTagAndFireSideEffects(db, 'friend-b', 'tag-1');

    expect(countEvents('tag_added')).toBe(0);
    const any = sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM conversion_events WHERE conversion_point_id = 'point-tag_added'`,
      )
      .get() as { n: number };
    expect(any.n).toBe(0);
  });

  test('起点が違う地点には入らない', async () => {
    addPoint('ec_order_confirmed');

    await attachTagAndFireSideEffects(db, 'friend-1', 'tag-1');

    expect(countEvents('ec_order_confirmed')).toBe(0);
  });

  test('停止中の地点には入らない', async () => {
    sqlite
      .prepare(
        `INSERT INTO conversion_points
           (id, name, event_type, value, status, measure_method, count_repeat, line_account_id)
         VALUES ('point-tag_added', '停止中', 'tag_added', 1000, 'stopped', 'webhook', 1, 'account-a')`,
      )
      .run();

    await attachTagAndFireSideEffects(db, 'friend-1', 'tag-1');

    expect(countEvents('tag_added')).toBe(0);
  });
});

// ---- 絞り込みの SQL そのものを見る -----------------------------------------

/*
 * ここは `conversion_events` の件数ではなく、返ってきた `matched`
 * (= 地点を引く SQL が何件拾ったか) を見る。
 *
 * 件数だけを見ていると、**絞り込みを外しても緑のまま**になる。外した分は
 * trackConversion 側の停止判定・アカウント判定が投げて弾くため、記録は
 * 増えないからである(2026-09-11 の逆変異 M8/M9 で実際にそうなった)。
 * それでは「この関数の絞り込み」は誰も見張っていない。
 */
describe('地点の絞り込み(実DB・SQLを直接見る)', () => {
  function point(
    id: string,
    over: { eventType?: string; status?: string; accountId?: string | null } = {},
  ) {
    sqlite
      .prepare(
        `INSERT INTO conversion_points
           (id, name, event_type, value, status, measure_method, count_repeat, line_account_id)
         VALUES (?, ?, ?, 1000, ?, 'webhook', 1, ?)`,
      )
      .run(
        id,
        id,
        over.eventType ?? 'tag_added',
        over.status ?? 'active',
        over.accountId === undefined ? 'account-a' : over.accountId,
      );
  }

  async function record(friendId = 'friend-1') {
    return recordConversionSourceEvent(db, {
      sourceType: 'tag_added',
      friendId,
      sourceEventId: `${friendId}:probe`,
    });
  }

  test('自分のアカウントの地点と全店共通の地点だけを拾う', async () => {
    point('p-mine');
    point('p-common', { accountId: null });
    point('p-other', { accountId: 'account-b' });
    sqlite.exec(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, tenant_id, is_active)
      VALUES ('account-b', 'ch-b', 'B店', 'tok-b', 'sec-b', 'tenant-1', 1);
    `);

    const result = await record();
    expect(result).toEqual({ matched: 2, recorded: 2, failed: 0, skipped: null });
  });

  test('停止中の地点は拾わない', async () => {
    point('p-stopped', { status: 'stopped' });

    const result = await record();
    expect(result).toEqual({ matched: 0, recorded: 0, failed: 0, skipped: null });
  });

  test('起点が違う地点は拾わない', async () => {
    point('p-ec', { eventType: 'ec_order_confirmed' });

    const result = await record();
    expect(result).toEqual({ matched: 0, recorded: 0, failed: 0, skipped: null });
  });

  test('別アカウントの友だちは、こちらのアカウントの地点を拾わない', async () => {
    point('p-mine');
    sqlite.exec(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, tenant_id, is_active)
      VALUES ('account-b', 'ch-b', 'B店', 'tok-b', 'sec-b', 'tenant-1', 1);
      INSERT INTO friends (id, line_user_id, line_account_id, display_name, is_following)
      VALUES ('friend-b', 'Ubbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'account-b', '別店の人', 1);
    `);

    const result = await record('friend-b');
    expect(result).toEqual({ matched: 0, recorded: 0, failed: 0, skipped: null });
  });

  test('同じ元イベントの再送では2度目を記録しない', async () => {
    point('p-mine');

    const first = await record();
    const second = await record();
    expect(first.recorded).toBe(1);
    expect(second.recorded).toBe(1);
    const row = sqlite
      .prepare(`SELECT COUNT(*) AS n FROM conversion_events WHERE conversion_point_id = 'p-mine'`)
      .get() as { n: number };
    expect(row.n).toBe(1);
  });
});

// ---- 6. 注文が確定した (ec_order_confirmed) -------------------------------

describe('起点6: 注文が確定した (ec_order_confirmed)', () => {
  async function sign(timestamp: string, body: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(ECCUBE_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${timestamp}.account-a.${body}`),
    );
    return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function post(eventId: string) {
    const body = JSON.stringify({
      event_id: eventId,
      event_type: 'ec.order.confirmed',
      occurred_at: '2026-11-01T00:00:00+09:00',
      customer_id: 'c-1',
      line_user_id: LINE_USER_ID,
      order: { number: 'ORD-1', total: 5400, items: [{ name: 'ごはん', quantity: 1 }] },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const app = new Hono<Env>();
    app.route('/', ecIntegrations);
    const exec = makeExecCtx();
    const res = await app.fetch(
      new Request('https://worker.example.test/api/integrations/eccube/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-line-account-id': 'account-a',
          'x-nen-timestamp': timestamp,
          'x-nen-signature': `sha256=${await sign(timestamp, body)}`,
        },
        body,
      }),
      env(),
      exec.ctx,
    );
    await exec.drain();
    return res;
  }

  test('注文確定の受信で成果が1件数えられ、同じ注文の再送では増えない', async () => {
    addPoint('ec_order_confirmed');

    const first = await post('ec-event-1');
    expect(first.status).toBe(200);
    expect(countEvents('ec_order_confirmed')).toBe(1);

    await post('ec-event-1');
    expect(countEvents('ec_order_confirmed')).toBe(1);
  });
});
