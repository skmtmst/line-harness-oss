/*
 * 友だちタイムライン `GET /api/friends/:id/timeline` の問い合わせ試験。
 *
 * 元は票 #717 の「8項 compound SELECT を D1 の
 * SQLITE_MAX_COMPOUND_SELECT(既定5) 以下に収めるため 4+4 の CTE へ割る」
 * 直しの試験。IDEA-03 で専用ソースが 10 項（group_a 4 + group_b 4 +
 * group_c 2、外側 3 項）へ増えたので、ここでは今の問い合わせの
 * 契約を固定する。
 *
 * - 全ソースの行が時系列（occurred_at DESC, id DESC）1本で返る
 * - 注文（ec_orders）と写真投稿（nen_photo_submissions）が入る
 * - analytics_events のうち専用台帳と同じ出来事を表す event_type
 *   （message_received 等）は重複して出さない
 * - status と source（kind/id/parentId/url）が行へ乗る
 * - 他の友だちの行が混ざらない
 * - ページングは +1 件先読みで nextCursor を返す
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Env } from '../index.js';

const FRIENDS_TS = join(process.cwd(), 'src/routes/friends.ts');

/** friends.ts からタイムラインの問い合わせをそのまま抜き出す。 */
function extractTimelineQuery(): string {
  const source = readFileSync(FRIENDS_TS, 'utf8');
  const match = /`(WITH group_a AS[\s\S]*?LIMIT \? OFFSET \?)`/.exec(source);
  if (!match) {
    throw new Error(
      'friends.ts からタイムラインの問い合わせを抜き出せませんでした。' +
        'クエリの書き方を変えたなら、この抽出パターンも合わせて直してください。',
    );
  }
  return match[1];
}

vi.mock('../services/account-access.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/account-access.js')>()),
  canAccessAllLineAccounts: vi.fn(async () => true),
}));
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: class {
    pushMessage = vi.fn();
  },
}));

const { friends } = await import('./friends.js');

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
      const bound = (params: unknown[]): D1PreparedStatement =>
        ({
          bind: (...next: unknown[]) => bound(next),
          all: async <T>() => ({
            success: true,
            results: call((...a) => statement.all(...a), params) as T[],
            meta: {},
          }),
          first: async <T>() => (call((...a) => statement.get(...a), params) as T | undefined) ?? null,
          run: async <T>() => {
            const changes = statement.reader
              ? (call((...a) => statement.all(...a), params) as unknown[]).length
              : call((...a) => statement.run(...a), params).changes;
            return { success: true, results: [], meta: { changes } } as T;
          },
          raw: async () => [],
        }) as unknown as D1PreparedStatement;
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

function createApp(db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', name: 'テスト', role: 'owner', readOnly: false, tenantId: 'tenant-1' });
    c.env = { DB: db } as Env['Bindings'];
    await next();
  });
  app.route('/', friends);
  return app;
}

interface TimelineItem {
  id: string;
  type: string;
  summary: string;
  status: string | null;
  source: { kind: string; id: string; parentId: string | null; url: string | null };
  occurredAt: string;
}

async function fetchTimeline(app: Hono<Env>, query = '') {
  const res = await app.request(`/api/friends/friend-1/timeline${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as {
    success: boolean;
    data: { items: TimelineItem[]; nextCursor: string | null };
  };
}

let sqlite: Database.Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(readFileSync(join(process.cwd(), '../../packages/db/bootstrap.sql'), 'utf8'));

  sqlite
    .prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('acct-1', 'channel-1', '本店', 'token', 'secret')`,
    )
    .run();
  sqlite
    .prepare(
      `INSERT INTO friends (id, line_user_id, display_name, line_account_id)
       VALUES ('friend-1', 'U-friend-1', 'テスト太郎', 'acct-1'),
              ('friend-2', 'U-friend-2', '他人花子', 'acct-1')`,
    )
    .run();

  // group_a: messages_log（2件、direction違い） + form_submissions（1件）
  sqlite
    .prepare(
      `INSERT INTO messages_log (id, friend_id, direction, message_type, content, created_at)
       VALUES ('msg-old', 'friend-1', 'incoming', 'text', '古いメッセージ', '2026-09-01T10:00:00.000')`,
    )
    .run();
  sqlite
    .prepare(
      `INSERT INTO messages_log (id, friend_id, direction, message_type, content, created_at)
       VALUES ('msg-new', 'friend-1', 'outgoing', 'text', '新しいメッセージ', '2026-09-03T10:00:00.000')`,
    )
    .run();
  sqlite.prepare(`INSERT INTO forms (id, name) VALUES ('form-1', '来店アンケート')`).run();
  sqlite
    .prepare(
      `INSERT INTO form_submissions (id, form_id, friend_id, created_at)
       VALUES ('form-sub-1', 'form-1', 'friend-1', '2026-09-02T10:00:00.000')`,
    )
    .run();

  // group_b: event_bookings（1件） + analytics_events（1件）
  sqlite
    .prepare(`INSERT INTO events (id, line_account_id, name) VALUES ('event-1', 'acct-1', '秋の見学会')`)
    .run();
  sqlite
    .prepare(
      `INSERT INTO event_slots (id, event_id, starts_at, ends_at)
       VALUES ('slot-1', 'event-1', '2026-09-10T10:00:00.000', '2026-09-10T11:00:00.000')`,
    )
    .run();
  // updated_at は NOT NULL で列既定は「今」。COALESCE(updated_at, requested_at)
  // で使われる値を固定するため、requested_at と同じ値を明示的に入れる。
  sqlite
    .prepare(
      `INSERT INTO event_bookings (id, line_account_id, event_id, slot_id, friend_id, status, requested_at, updated_at)
       VALUES ('booking-1', 'acct-1', 'event-1', 'slot-1', 'friend-1', 'confirmed',
               '2026-09-04T10:00:00.000', '2026-09-04T10:00:00.000')`,
    )
    .run();
  sqlite
    .prepare(
      `INSERT INTO analytics_events
         (id, line_account_id, friend_id, event_type, source_kind, source_id, occurred_at, idempotency_key)
       VALUES ('ae-1', 'acct-1', 'friend-1', 'custom_event', 'analytics', 'ae-1',
               '2026-09-05T10:00:00.000', 'idem-1')`,
    )
    .run();
});

afterEach(() => {
  sqlite.close();
});

describe('GET /api/friends/:id/timeline（10ソースを3CTEへ割った問い合わせ）', () => {
  test('どのcompound SELECTもD1の上限（5項）に収まる形を保つ', () => {
    // group_a(4項=UNION ALL×3) + group_b(4項=×3) + group_c(2項=×1)
    // + 外側(3項=×2)。ソースを足すときはこの形のままにする。
    const query = extractTimelineQuery();
    expect((query.match(/UNION ALL/g) ?? []).length).toBe(9);
    expect(query).toContain('group_a AS');
    expect(query).toContain('group_b AS');
    expect(query).toContain('group_c AS');
  });

  test('各CTE由来の行が時系列1本・重複なしで統合される', async () => {
    const app = createApp(asD1(sqlite));
    const body = await fetchTimeline(app);
    expect(body.success).toBe(true);
    // occurred_at DESC。CTEの別々の塊のままではなく1本の時系列へ統合
    // されていることを、group_a/group_b の交互並びで確かめる。
    expect(body.data.items.map((i) => i.id)).toEqual([
      'ae-1', // 2026-09-05 analytics_events (group_b)
      'booking-1', // 2026-09-04 event_bookings (group_b)
      'msg-new', // 2026-09-03 messages_log (group_a)
      'form-sub-1', // 2026-09-02 form_submissions (group_a)
      'msg-old', // 2026-09-01 messages_log (group_a)
    ]);
    expect(new Set(body.data.items.map((i) => `${i.source.kind}:${i.id}`)).size).toBe(5);
    expect(body.data.nextCursor).toBeNull();
  });

  test('limitに収まらない件数があるとnextCursorが付く（+1件先読み方式）', async () => {
    const app = createApp(asD1(sqlite));
    const body = await fetchTimeline(app, '?limit=3');
    expect(body.data.items.map((i) => i.id)).toEqual(['ae-1', 'booking-1', 'msg-new']);
    expect(body.data.nextCursor).toBe('3');
  });

  test('status と source（kind/id/parentId/url）が行へ乗る', async () => {
    const app = createApp(asD1(sqlite));
    const body = await fetchTimeline(app);
    const booking = body.data.items.find((i) => i.id === 'booking-1');
    expect(booking?.type).toBe('event_booking');
    expect(booking?.status).toBe('confirmed');
    expect(booking?.source).toEqual({
      kind: 'event_booking',
      id: 'booking-1',
      parentId: 'event-1',
      url: null,
    });
    const form = body.data.items.find((i) => i.id === 'form-sub-1');
    expect(form?.source).toEqual({
      kind: 'form_submission',
      id: 'form-sub-1',
      parentId: 'form-1',
      url: null,
    });
    const message = body.data.items.find((i) => i.id === 'msg-new');
    expect(message?.source.kind).toBe('message');
    expect(message?.status).toBeNull();
  });

  test('注文（ec_orders）が種別・状態・注文詳細URLつきで返る', async () => {
    sqlite
      .prepare(
        `INSERT INTO ec_events (id, source, external_event_id, event_type, friend_id, payload, status, received_at, updated_at)
         VALUES ('ev-1', 'eccube', 'ext-ev-1', 'ec.order.confirmed', 'friend-1', '{}', 'processed',
                 '2026-09-06T10:00:00.000', '2026-09-06T10:00:00.000')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO ec_orders
           (id, line_account_id, source_key, external_order_id, friend_id,
            order_number, normalized_status, provider_status,
            ordered_at, detail_url, last_event_id, created_at, updated_at)
         VALUES ('order-1', 'acct-1', 'eccube', 'ext-1', 'friend-1',
                 'ORD-1001', 'refunded', 'paid', '2026-09-06T10:00:00.000',
                 'https://shop.example/orders/1', 'ev-1', '2026-09-06T10:00:00.000', '2026-09-07T10:00:00.000')`,
      )
      .run();
    const app = createApp(asD1(sqlite));
    const body = await fetchTimeline(app);
    const order = body.data.items.find((i) => i.id === 'order-1');
    expect(order?.type).toBe('ec_order');
    expect(order?.status).toBe('refunded');
    expect(order?.summary).toContain('ORD-1001');
    expect(order?.source).toEqual({
      kind: 'ec_order',
      id: 'order-1',
      parentId: null,
      url: 'https://shop.example/orders/1',
    });
    // 注文は発生日時（ordered_at）で並ぶ。updated_at が新しくても
    // 時系列の位置は動かさない（ページングを安定させるため）。
    expect(body.data.items[0].id).toBe('order-1');
  });

  test('写真投稿（nen_photo_submissions）が種別・審査状態・画像URLつきで返る', async () => {
    sqlite
      .prepare(
        `INSERT INTO nen_pet_profiles (id, friend_id, name, created_at, updated_at)
         VALUES ('pet-1', 'friend-1', 'ポチ', '2026-09-01T00:00:00.000', '2026-09-01T00:00:00.000')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO nen_photo_submissions
           (id, friend_id, pet_id, r2_key, image_url, content_type, status, created_at, updated_at)
         VALUES ('photo-1', 'friend-1', 'pet-1', 'photos/1.jpg',
                 'https://img.example/1.jpg', 'image/jpeg', 'adopted',
                 '2026-09-06T10:00:00.000', '2026-09-06T10:00:00.000')`,
      )
      .run();
    const app = createApp(asD1(sqlite));
    const body = await fetchTimeline(app);
    const photo = body.data.items.find((i) => i.id === 'photo-1');
    expect(photo?.type).toBe('photo_submitted');
    expect(photo?.status).toBe('adopted');
    expect(photo?.source).toEqual({
      kind: 'nen_photo_submission',
      id: 'photo-1',
      parentId: null,
      url: 'https://img.example/1.jpg',
    });
  });

  test('他の友だちの注文・投稿・メッセージは混ざらない', async () => {
    sqlite
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, created_at)
         VALUES ('other-msg', 'friend-2', 'incoming', 'text', '他人のメッセージ', '2026-09-07T10:00:00.000')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO ec_events (id, source, external_event_id, event_type, friend_id, payload, status, received_at, updated_at)
         VALUES ('ev-2', 'eccube', 'ext-ev-2', 'ec.order.confirmed', 'friend-2', '{}', 'processed',
                 '2026-09-07T10:00:00.000', '2026-09-07T10:00:00.000')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO ec_orders
           (id, line_account_id, source_key, external_order_id, friend_id,
            order_number, normalized_status, provider_status,
            ordered_at, last_event_id, created_at, updated_at)
         VALUES ('other-order', 'acct-1', 'eccube', 'ext-2', 'friend-2',
                 'ORD-2002', 'current', 'paid', '2026-09-07T10:00:00.000',
                 'ev-2', '2026-09-07T10:00:00.000', '2026-09-07T10:00:00.000')`,
      )
      .run();
    const app = createApp(asD1(sqlite));
    const body = await fetchTimeline(app);
    expect(body.data.items.map((i) => i.id)).not.toContain('other-msg');
    expect(body.data.items.map((i) => i.id)).not.toContain('other-order');
    expect(body.data.items).toHaveLength(5);
  });

  /*
   * IDEA-03「重複なし」。受信メッセージは messages_log と
   * analytics_events の両方へ記録される（webhook.ts）。
   * analytics 側の同じ出来事は履歴から外す。
   */
  test('analytics_events のうち専用台帳と同じ出来事のevent_typeは出さない', async () => {
    sqlite
      .prepare(
        `INSERT INTO analytics_events
           (id, line_account_id, friend_id, event_type, source_kind, source_id, occurred_at, idempotency_key)
         VALUES ('ae-dup-msg', 'acct-1', 'friend-1', 'message_received', 'line_webhook', 'wh-1',
                 '2026-09-03T11:00:00.000', 'idem-dup-msg'),
                ('ae-form', 'acct-1', 'friend-1', 'form_submitted', 'form', 'form-sub-1',
                 '2026-09-02T11:00:00.000', 'idem-dup-form'),
                ('ae-booking', 'acct-1', 'friend-1', 'booking_confirmed', 'booking', 'booking-1',
                 '2026-09-04T11:00:00.000', 'idem-dup-booking'),
                ('ae-order', 'acct-1', 'friend-1', 'ec.order.confirmed', 'ec_event', 'ev-1',
                 '2026-09-06T11:00:00.000', 'idem-dup-order'),
                ('ae-tag', 'acct-1', 'friend-1', 'tag_change', 'tag', 'tag-1',
                 '2026-09-05T11:00:00.000', 'idem-tag')`,
      )
      .run();
    const app = createApp(asD1(sqlite));
    const body = await fetchTimeline(app);
    const ids = body.data.items.map((i) => i.id);
    // 専用台帳の行と同じ出来事の analytics 行は出ない。
    expect(ids).not.toContain('ae-dup-msg');
    expect(ids).not.toContain('ae-form');
    expect(ids).not.toContain('ae-booking');
    expect(ids).not.toContain('ae-order');
    // 専用台帳を持たないイベント（タグ変更・カスタム）は残る。
    expect(ids).toContain('ae-tag');
    expect(ids).toContain('ae-1');
    // 受信メッセージは messages_log の1行だけ。
    expect(ids.filter((id) => id === 'msg-old')).toHaveLength(1);
  });

  test('対象の友だちにレコードが無いときは0件', async () => {
    const res = await createApp(asD1(sqlite)).request('/api/friends/friend-2/timeline');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { items: unknown[] } };
    expect(body.data.items).toHaveLength(0);
  });
});

describe('ORDER BYのtiebreak（仕様固定）', () => {
  test('occurred_atが同値のときは、CTEをまたいでもtimeline.id降順で確定的に並ぶ', async () => {
    const sameOccurredAt = '2026-09-06T10:00:00.000';
    sqlite
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, created_at)
         VALUES ('tie-a', 'friend-1', 'incoming', 'text', '同着a', ?)`,
      )
      .run(sameOccurredAt);
    sqlite
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, created_at)
         VALUES ('tie-c', 'friend-1', 'incoming', 'text', '同着c', ?)`,
      )
      .run(sameOccurredAt);
    sqlite
      .prepare(
        `INSERT INTO analytics_events
           (id, line_account_id, friend_id, event_type, source_kind, source_id, occurred_at, idempotency_key)
         VALUES ('tie-b', 'acct-1', 'friend-1', 'custom_event', 'analytics', 'tie-b', ?, 'idem-tie-b')`,
      )
      .run(sameOccurredAt);

    const app = createApp(asD1(sqlite));
    const body = await fetchTimeline(app);
    const tieIds = body.data.items.map((i) => i.id).filter((id) => id.startsWith('tie-'));

    // 文字列としての id 降順 = tie-c, tie-b, tie-a。
    expect(tieIds).toEqual(['tie-c', 'tie-b', 'tie-a']);
  });
});
