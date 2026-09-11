/*
 * 友だちタイムライン `GET /api/friends/:id/timeline` の問い合わせ試験（票 #717）。
 *
 * D1 の `SQLITE_MAX_COMPOUND_SELECT`（既定 5。`wrangler d1 execute --local`
 * で実測 — 手元の better-sqlite3 は既定 500 なのでこの試験では見えない）に
 * 対し、直す前の問い合わせは 8 項の compound SELECT（`UNION ALL` を 7 つ）
 * で、D1 では `too many terms in compound SELECT: SQLITE_ERROR` になる。
 * D1（miniflare/workerd）での再現は Issue #717 のコメントに一度手で流した
 * 出力を貼ってある。必須ゲートには置かない（司令塔方針：#698・#720と同種の
 * 重さを必須ゲートへ増やさない）。
 *
 * ここで固定するのは「割ったら結果が変わっていないか」。8 項を 4 項 + 4 項の
 * CTE（`group_a` / `group_b`）へ割った後の問い合わせ（friends.ts から
 * そのまま抜き出す）と、割る前の問い合わせ（このファイルに固定したコピー）
 * を、同じテストデータ・同じ bind 引数で both better-sqlite3 へ通し、
 * 返る行が完全に一致する（並び順・重複の扱いも含めて）ことを突き合わせる。
 * better-sqlite3 は上限500なのでどちらの形でも動く。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Env } from '../index.js';

const FRIENDS_TS = join(process.cwd(), 'src/routes/friends.ts');

/** friends.ts から「直したあと」のタイムライン問い合わせをそのまま抜き出す。 */
function extractAfterQuery(): string {
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

/**
 * 直す前（票 #717・N-717）の問い合わせ。8項のcompound SELECTで、D1では
 * "too many terms in compound SELECT" になっていた形をそのまま固定した
 * コピー。書き換えない（書き換えたら「直す前」との突き合わせにならない）。
 */
const BEFORE_QUERY = `SELECT timeline.id, timeline.event_type, timeline.summary,
        timeline.source_kind, timeline.source_id, timeline.occurred_at,
        timeline.line_account_id, la.name AS line_account_name
   FROM (
     SELECT ml.id,
            CASE WHEN ml.direction = 'incoming' THEN 'message_received' ELSE 'message_sent' END AS event_type,
            CASE WHEN ml.direction = 'incoming' THEN 'メッセージを受信しました' ELSE 'メッセージを送信しました' END AS summary,
            'message' AS source_kind, ml.id AS source_id, ml.created_at AS occurred_at,
            COALESCE(ml.line_account_id, f.line_account_id) AS line_account_id
       FROM messages_log ml JOIN friends f ON f.id = ml.friend_id
      WHERE ml.friend_id = ? AND (ml.delivery_type IS NULL OR ml.delivery_type != 'test')
     UNION ALL
     SELECT fs.id, 'form_submitted', '回答フォームへ回答しました',
            'form_submission', fs.id, fs.created_at, f.line_account_id
       FROM form_submissions fs JOIN friends f ON f.id = fs.friend_id
      WHERE fs.friend_id = ?
     UNION ALL
     SELECT b.id, 'booking', 'カレンダー予約が更新されました',
            'booking', b.id, COALESCE(b.updated_at, b.created_at), b.line_account_id
       FROM bookings b WHERE b.friend_id = ?
     UNION ALL
     SELECT cb.id, 'calendar_booking', '外部カレンダー予約が更新されました',
            'calendar_booking', cb.id, COALESCE(cb.updated_at, cb.created_at), f.line_account_id
       FROM calendar_bookings cb JOIN friends f ON f.id = cb.friend_id
      WHERE cb.friend_id = ?
     UNION ALL
     SELECT eb.id, 'event_booking', 'イベント予約が更新されました',
            'event_booking', eb.id, COALESCE(eb.updated_at, eb.requested_at), eb.line_account_id
       FROM event_bookings eb WHERE eb.friend_id = ?
     UNION ALL
     SELECT fr.id, 'reminder', 'リマインダが更新されました',
            'friend_reminder', fr.id, COALESCE(fr.updated_at, fr.created_at), f.line_account_id
       FROM friend_reminders fr JOIN friends f ON f.id = fr.friend_id
      WHERE fr.friend_id = ?
     UNION ALL
     SELECT ie.id, ie.event_type, ie.summary,
            'identity_event', ie.id, ie.occurred_at, f.line_account_id
       FROM identity_events ie JOIN friends f ON f.user_id = ie.user_id
      WHERE f.id = ? AND ie.tenant_id = COALESCE(
        (SELECT la2.tenant_id FROM line_accounts la2 WHERE la2.id = f.line_account_id),
        '00000000-0000-4000-8000-000000000001'
      )
     UNION ALL
     SELECT ae.id, ae.event_type, '共通イベントを記録しました',
            ae.source_kind, ae.source_id, ae.occurred_at, ae.line_account_id
       FROM analytics_events ae WHERE ae.friend_id = ?
   ) timeline
   LEFT JOIN line_accounts la ON la.id = timeline.line_account_id
  ORDER BY timeline.occurred_at DESC, timeline.id DESC
  LIMIT ? OFFSET ?`;

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
       VALUES ('friend-1', 'U-friend-1', 'テスト太郎', 'acct-1')`,
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

describe('GET /api/friends/:id/timeline（compound SELECTを4+4のCTEへ割った後）', () => {
  test('8ソース中5ソース（group_a由来3件・group_b由来2件）が同じ並び順・重複なしで統合される', async () => {
    const app = createApp(asD1(sqlite));
    const res = await app.request('/api/friends/friend-1/timeline');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { items: Array<{ id: string; type: string; occurredAt: string }>; nextCursor: string | null };
    };
    expect(body.success).toBe(true);
    // occurred_at DESC。group_a由来とgroup_b由来が交互に並ぶ位置にあることで、
    // 2つのCTEが「別々の塊」のままではなく1本の時系列へ正しく統合されている
    // ことを確かめる（分割ミスだと group_a が先にまとまって出るなど崩れる）。
    expect(body.data.items.map((i) => i.id)).toEqual([
      'ae-1', // 2026-09-05 analytics_events (group_b)
      'booking-1', // 2026-09-04 event_bookings (group_b)
      'msg-new', // 2026-09-03 messages_log (group_a)
      'form-sub-1', // 2026-09-02 form_submissions (group_a)
      'msg-old', // 2026-09-01 messages_log (group_a)
    ]);
    // 重複なし（UNION ALLのまま、5件が5件のまま出る）。
    expect(body.data.items).toHaveLength(5);
    expect(new Set(body.data.items.map((i) => i.id)).size).toBe(5);
    expect(body.data.nextCursor).toBeNull();
  });

  test('limitに収まらない件数があるとnextCursorが付く（ページングは分割前と同じ+1件先読み方式）', async () => {
    const app = createApp(asD1(sqlite));
    const res = await app.request('/api/friends/friend-1/timeline?limit=3');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { items: Array<{ id: string }>; nextCursor: string | null };
    };
    expect(body.data.items.map((i) => i.id)).toEqual(['ae-1', 'booking-1', 'msg-new']);
    expect(body.data.nextCursor).toBe('3');
  });
});

describe('割る前(8項)と割ったあと(4+4のCTE)の突き合わせ（票 #717 直しの本体）', () => {
  test('同じ入力に同じ行が同じ並び順・同じ重複の扱いで返る', () => {
    const friendId = 'friend-1';
    const bindArgs = [friendId, friendId, friendId, friendId, friendId, friendId, friendId, friendId, 51, 0];

    const before = sqlite.prepare(BEFORE_QUERY).all(...bindArgs);
    const after = sqlite.prepare(extractAfterQuery()).all(...bindArgs);

    // 割る前(8項、better-sqlite3の上限500では通る)と割ったあと(4+4のCTE)を
    // 同じ入力で突き合わせる。ここが変わっていたら「割ったら結果が
    // 変わった」ということなので、直したことにならない。
    expect(after).toEqual(before);
    expect(after).toHaveLength(5);
  });

  test('全列が同じ行が2つあっても、割る前と同じく2つ返る(UNION へ変えると1つに減る)', () => {
    // identity_events と analytics_events だけが event_type / summary /
    // source_kind / source_id を自由に置けるので、7列すべてが一致する行を
    // 作れる（他の組は summary が固定文字列で違うため一致させられない）。
    // 外側の UNION ALL を UNION に書き換える変異を当てると、この2行が
    // 1行に減って落ちる（票 #717 差し戻し起因）。
    sqlite.prepare(`INSERT INTO users (id, tenant_id) VALUES ('user-1', '00000000-0000-4000-8000-000000000001')`).run();
    sqlite.prepare(`UPDATE friends SET user_id = 'user-1' WHERE id = 'friend-1'`).run();
    sqlite
      .prepare(
        `INSERT INTO identity_events (id, tenant_id, user_id, event_type, summary, actor_name, occurred_at, correlation_id)
         VALUES ('dup-1', '00000000-0000-4000-8000-000000000001', 'user-1', 'profile',
                 '共通イベントを記録しました', 'sys', '2026-09-06T10:00:00.000', 'corr-1')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO analytics_events
           (id, line_account_id, friend_id, event_type, source_kind, source_id, occurred_at, idempotency_key)
         VALUES ('dup-1', 'acct-1', 'friend-1', 'profile', 'identity_event', 'dup-1',
                 '2026-09-06T10:00:00.000', 'idem-dup')`,
      )
      .run();

    const f = 'friend-1';
    const bindArgs = [f, f, f, f, f, f, f, f, 51, 0];
    const before = sqlite.prepare(BEFORE_QUERY).all(...bindArgs) as { id: string }[];
    const after = sqlite.prepare(extractAfterQuery()).all(...bindArgs) as { id: string }[];

    expect(after).toEqual(before);
    expect(after.filter((r) => r.id === 'dup-1')).toHaveLength(2);
  });

  test('limitを絞っても同じ行が返る(ページングの先読みも一致)', () => {
    const friendId = 'friend-1';
    const bindArgs = [friendId, friendId, friendId, friendId, friendId, friendId, friendId, friendId, 4, 0];

    const before = sqlite.prepare(BEFORE_QUERY).all(...bindArgs);
    const after = sqlite.prepare(extractAfterQuery()).all(...bindArgs);

    expect(after).toEqual(before);
  });

  test('対象の友だちにレコードが無くても両方とも0件で一致する', () => {
    const bindArgs = ['friend-nobody', 'friend-nobody', 'friend-nobody', 'friend-nobody',
      'friend-nobody', 'friend-nobody', 'friend-nobody', 'friend-nobody', 51, 0];

    const before = sqlite.prepare(BEFORE_QUERY).all(...bindArgs);
    const after = sqlite.prepare(extractAfterQuery()).all(...bindArgs);

    expect(after).toEqual(before);
    expect(after).toHaveLength(0);
  });
});

describe('ORDER BYのtiebreak（仕様固定）', () => {
  // occurred_at が同値のときの並びは SQLite の「不定」なので、割る前の
  // クエリと突き合わせても同じ順で返るとは限らない（実測でも7ケース中2
  // ケースで不一致になった）。確率で赤くなる試験は置けないため、ここだけは
  // 「割る前と同じか」ではなく「timeline.id DESC で決定的に並ぶ」という
  // いまの仕様そのものを固定の期待値で書く。
  test('occurred_atが同値のときは、グループ(group_a/group_b)をまたいでもtimeline.id降順で確定的に並ぶ', async () => {
    const sameOccurredAt = '2026-09-06T10:00:00.000';
    // group_a由来(messages_log)とgroup_b由来(analytics_events)を混ぜる。
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
    const res = await app.request('/api/friends/friend-1/timeline');
    const body = (await res.json()) as { data: { items: Array<{ id: string }> } };
    const tieIds = body.data.items.map((i) => i.id).filter((id) => id.startsWith('tie-'));

    // 文字列としての id 降順 = tie-c, tie-b, tie-a。
    expect(tieIds).toEqual(['tie-c', 'tie-b', 'tie-a']);
  });
});
