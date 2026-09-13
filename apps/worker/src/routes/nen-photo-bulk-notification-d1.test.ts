/*
 * N-306 #639: 一括審査の通知を実D1（bootstrap.sql を流した SQLite）と
 * LINE送信 mock で固定する。手書きのDBモックだと「通知が本当に呼ばれたか」
 * 「送達台帳に何が残ったか」「その残り方で再送できるか」が確かめられない。
 *
 * 押さえる契約:
 *  1. 一括の各対象へ、単票審査とまったく同じ本文が本人のLINE宛に送られる
 *  2. 一部の送信が失敗しても残りは送られ、失敗分は failed で残って再送できる
 *  3. 対象1件の通知準備が落ちても後続は止まらず、その対象も再送で復旧できる
 * 外部LINEへは送らない（pushViaHarnessProxy を mock）。
 */
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestD1 } from '../test-utils/d1-sqlite.js';

const accountAccess = vi.hoisted(() => ({ canAccessAllLineAccounts: vi.fn(async () => true) }));
vi.mock('../services/account-access.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  canAccessAllLineAccounts: accountAccess.canAccessAllLineAccounts,
}));

// LINE送信は mock だけ。実送信はしない。
type PushCall = { to: string; text: string; retryKey: string | undefined };
const line = vi.hoisted(() => ({
  push: vi.fn(),
  calls: [] as Array<{ to: string; text: string; retryKey: string | undefined }>,
  failFor: new Set<string>(),
}));
vi.mock('../services/line-proxy-send.js', () => ({
  pushViaHarnessProxy: line.push,
}));

const { nenPhotoOperations } = await import('./nen-photo-operations.js');
const { nenMembers } = await import('./nen-members.js');

const ACCOUNT = 'account-a';
const PHOTOS = ['photo-a', 'photo-b', 'photo-c'] as const;

let sql: Database.Database;
let db: D1Database;

function seed(raw: Database.Database): void {
  raw.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-a', 'channel-a', 'A店', 'token-a', 'secret-a');
    INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following,
                         created_at, updated_at)
    VALUES ('friend-a', 'U-friend-a', 'Aさん', 'account-a', 1,
            '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');
    INSERT INTO nen_pet_profiles (id, friend_id, name, created_at, updated_at)
    VALUES ('pet-a', 'friend-a', 'ハナ', '2026-09-01', '2026-09-01');
  `);
  for (const photoId of PHOTOS) {
    raw.prepare(
      `INSERT INTO nen_photo_submissions
        (id, friend_id, pet_id, r2_key, image_url, content_type, status, created_at,
         reviewed_at, updated_at, line_account_id, review_image_url, public_image_url, review_version)
       VALUES (?, 'friend-a', 'pet-a', ?, ?, 'image/jpeg', 'pending',
               '2026-09-01T00:00:00.000Z', NULL, '2026-09-01T00:00:00.000Z',
               'account-a', ?, NULL, 1)`,
    ).run(photoId, `original/${photoId}.jpg`, `legacy-${photoId}`, `https://cdn.test/${photoId}.jpg`);
    raw.prepare(
      `INSERT INTO nen_photo_risk_assessments
        (id, photo_id, line_account_id, flag, confidence, assessed_at, created_at)
       VALUES (?, ?, 'account-a', 'safe', 0.99, '2026-09-01', '2026-09-01')`,
    ).run(`risk-${photoId}`, photoId);
  }
}

/** 特定のSQL・引数のときだけ投げる D1。通知準備の一時的な失敗を作る。 */
function withFailure(
  base: D1Database,
  shouldFail: (query: string, bindings: unknown[]) => boolean,
): D1Database {
  return {
    prepare(query: string) {
      const statement = base.prepare(query);
      return {
        ...statement,
        bind(...bindings: unknown[]) {
          if (shouldFail(query, bindings)) {
            return {
              first: async () => { throw new Error('D1_ERROR: simulated'); },
              all: async () => { throw new Error('D1_ERROR: simulated'); },
              run: async () => { throw new Error('D1_ERROR: simulated'); },
            } as unknown as D1PreparedStatement;
          }
          return statement.bind(...bindings);
        },
      } as unknown as D1PreparedStatement;
    },
    batch: (statements: D1PreparedStatement[]) => base.batch(statements),
  } as unknown as D1Database;
}

function harness(database: D1Database) {
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('staff', {
      id: 'staff-a', name: '担当者', role: 'staff', readOnly: false,
      permissionKeys: ['photo.submission.view', 'photo.submission.review', 'photo.submission.bulk_review'],
    });
    c.env = { DB: database, IMAGES: { get: vi.fn() }, WORKER_PUBLIC_URL: 'https://worker.test' };
    await next();
  });
  app.route('/', nenPhotoOperations);
  app.route('/', nenMembers);
  return app;
}

function bulkRequest(
  decisions: Array<{ photoId: string; decision: 'approve' | 'reject'; reasonCode?: string }>,
  key: string,
): Request {
  return new Request('https://worker.test/api/nen-members/photos/decisions/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({
      lineAccountId: ACCOUNT,
      decisions: decisions.map((entry) => ({
        photoId: entry.photoId, decision: entry.decision, expectedVersion: 1,
        reasonCode: entry.decision === 'approve' ? null : (entry.reasonCode ?? 'quality'),
        reasonNote: null,
      })),
    }),
  });
}

function eventRow(photoId: string) {
  return sql.prepare(
    `SELECT id, notification_status, notification_error, notification_sent_at
       FROM nen_photo_review_events WHERE photo_id = ? AND line_account_id = ?`,
  ).get(photoId, ACCOUNT) as {
    id: string; notification_status: string;
    notification_error: string | null; notification_sent_at: string | null;
  } | undefined;
}

beforeEach(() => {
  const created = createTestD1();
  sql = created.raw;
  db = created.db;
  seed(sql);
  line.calls = [];
  line.failFor = new Set();
  line.push.mockReset();
  line.push.mockImplementation(async (
    _base: string, _token: string, to: string,
    messages: Array<{ type: string; text: string }>, retryKey?: string,
  ) => {
    const text = messages.map((message) => message.text).join('\n');
    line.calls.push({ to, text, retryKey });
    if (line.failFor.has(retryKey ?? '')) throw new Error('LINEの送信に失敗しました');
    return { requestId: 'req-1' };
  });
  accountAccess.canAccessAllLineAccounts.mockResolvedValue(true);
});

describe('一括審査の本人通知（実D1・LINE mock）', () => {
  it('各対象へ本人のLINEへ通知し、送達台帳へ sent が残る', async () => {
    const app = harness(db);
    const response = await app.fetch(bulkRequest([
      { photoId: 'photo-a', decision: 'approve' },
      { photoId: 'photo-b', decision: 'reject', reasonCode: 'privacy' },
    ], 'key-sent'));

    expect(response.status).toBe(201);
    const body = await response.json() as {
      data: { updatedCount: number; items: Array<{ photoId: string; notificationStatus: string }>;
        notificationFailures: PushCall[] };
    };
    expect(body.data.updatedCount).toBe(2);
    expect(body.data.notificationFailures).toEqual([]);
    expect(body.data.items.map((item) => item.notificationStatus)).toEqual(['sent', 'sent']);

    // 本人（友だちの line_user_id）宛に、対象の件数ぶん送っている。
    expect(line.calls).toHaveLength(2);
    expect(new Set(line.calls.map((call) => call.to))).toEqual(new Set(['U-friend-a']));
    expect(eventRow('photo-a')?.notification_status).toBe('sent');
    expect(eventRow('photo-b')?.notification_status).toBe('sent');
    expect(eventRow('photo-a')?.notification_sent_at).toBeTruthy();

    // 再送keyは審査イベントID（UUID）そのもの。LINE仕様のUUID形式を満たす。
    for (const call of line.calls) {
      expect(call.retryKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    }
  });

  it('本文が単票審査とまったく同じ（承認・見送りとも）', async () => {
    const app = harness(db);
    // 単票（承認）
    await app.fetch(new Request('https://worker.test/api/nen-members/photos/photo-a/review', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: ACCOUNT, status: 'adopted', expectedVersion: 1 }),
    }));
    // 単票（見送り）
    await app.fetch(new Request('https://worker.test/api/nen-members/photos/photo-b/review', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: ACCOUNT, status: 'rejected', expectedVersion: 1, reasonCode: 'privacy',
      }),
    }));
    const singleAdopted = line.calls[0]!.text;
    const singleRejected = line.calls[1]!.text;
    line.calls = [];

    // 一括（承認・見送りを混ぜる）。photo-c は承認、photo-a/b は審査済みなので別途用意。
    sql.prepare(
      `INSERT INTO nen_photo_submissions
        (id, friend_id, pet_id, r2_key, image_url, content_type, status, created_at,
         reviewed_at, updated_at, line_account_id, review_image_url, public_image_url, review_version)
       VALUES ('photo-d', 'friend-a', 'pet-a', 'original/d.jpg', 'legacy-d', 'image/jpeg', 'pending',
               '2026-09-01T00:00:00.000Z', NULL, '2026-09-01T00:00:00.000Z',
               'account-a', 'https://cdn.test/photo-d.jpg', NULL, 1)`,
    ).run();
    sql.prepare(
      `INSERT INTO nen_photo_risk_assessments
        (id, photo_id, line_account_id, flag, confidence, assessed_at, created_at)
       VALUES ('risk-photo-d', 'photo-d', 'account-a', 'safe', 0.99, '2026-09-01', '2026-09-01')`,
    ).run();

    const response = await app.fetch(bulkRequest([
      { photoId: 'photo-c', decision: 'approve' },
      { photoId: 'photo-d', decision: 'reject', reasonCode: 'privacy' },
    ], 'key-same-text'));
    expect(response.status).toBe(201);

    expect(line.calls).toHaveLength(2);
    expect(line.calls[0]!.text).toBe(singleAdopted);
    expect(line.calls[1]!.text).toBe(singleRejected);
  });

  it('1件の送信が失敗しても残りは送られ、失敗分は failed で残って再送できる', async () => {
    const app = harness(db);
    // 送信keyは決まっていないので、2件目の呼び出しだけ落とす。
    let sent = 0;
    line.push.mockImplementation(async (
      _base: string, _token: string, to: string,
      messages: Array<{ type: string; text: string }>, retryKey?: string,
    ) => {
      line.calls.push({ to, text: messages.map((m) => m.text).join('\n'), retryKey });
      sent += 1;
      if (sent === 2) throw new Error('LINEの送信に失敗しました');
      return { requestId: 'req-1' };
    });

    const response = await app.fetch(bulkRequest([
      { photoId: 'photo-a', decision: 'approve' },
      { photoId: 'photo-b', decision: 'approve' },
      { photoId: 'photo-c', decision: 'approve' },
    ], 'key-partial'));

    expect(response.status).toBe(201);
    const body = await response.json() as {
      data: {
        items: Array<{ photoId: string; notificationStatus: string }>;
        notificationFailures: Array<{ photoId: string; error: string }>;
      };
    };
    // 2件目で落ちても3件目まで送っている。
    expect(line.calls).toHaveLength(3);
    expect(body.data.notificationFailures.map((failure) => failure.photoId)).toEqual(['photo-b']);
    expect(eventRow('photo-a')?.notification_status).toBe('sent');
    expect(eventRow('photo-b')?.notification_status).toBe('failed');
    expect(eventRow('photo-c')?.notification_status).toBe('sent');

    // 失敗分は再送口で復旧できる。
    line.calls = [];
    line.push.mockImplementation(async (
      _base: string, _token: string, to: string,
      messages: Array<{ type: string; text: string }>, retryKey?: string,
    ) => {
      line.calls.push({ to, text: messages.map((m) => m.text).join('\n'), retryKey });
      return { requestId: 'req-2' };
    });
    const retry = await app.fetch(new Request(
      'https://worker.test/api/nen-members/photos/photo-b/notification/retry',
      {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: ACCOUNT }),
      },
    ));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ data: { notificationStatus: 'sent', resent: true } });
    expect(line.calls).toHaveLength(1);
    expect(eventRow('photo-b')?.notification_status).toBe('sent');
  });

  it('1件の通知準備が落ちても後続は送られ、その対象も再送で復旧できる', async () => {
    // photo-b の送信権claim だけ落とす。準備段階の一時的なDB障害を模す。
    const targetDecisionId = () => eventRow('photo-b')?.id ?? '';
    const failingDb = withFailure(db, (query, bindings) => (
      query.includes("SET notification_status = 'sending'")
      && bindings.includes(targetDecisionId())
    ));
    const app = harness(failingDb);

    const response = await app.fetch(bulkRequest([
      { photoId: 'photo-a', decision: 'approve' },
      { photoId: 'photo-b', decision: 'approve' },
      { photoId: 'photo-c', decision: 'approve' },
    ], 'key-prep-failure'));

    // 審査自体は確定する（通知フェーズの失敗は 201 を覆さない）。
    expect(response.status).toBe(201);
    const body = await response.json() as {
      data: {
        updatedCount: number;
        items: Array<{ photoId: string; notificationStatus: string }>;
        notificationFailures: Array<{ photoId: string; error: string }>;
      };
    };
    expect(body.data.updatedCount).toBe(3);

    // 落ちたのは photo-b だけで、後続の photo-c まで止まらない。
    expect(line.calls.map((call) => call.retryKey)).toEqual([
      eventRow('photo-a')?.id, eventRow('photo-c')?.id,
    ]);
    expect(body.data.notificationFailures.map((failure) => failure.photoId)).toEqual(['photo-b']);
    expect(eventRow('photo-a')?.notification_status).toBe('sent');
    expect(eventRow('photo-c')?.notification_status).toBe('sent');
    // 準備で落ちた対象は未送信のまま残る（送ってもいないのに sent にしない）。
    expect(eventRow('photo-b')?.notification_status).not.toBe('sent');

    // 準備で落ちた対象も、再送口から拾えて復旧できる。
    line.calls = [];
    const retry = await harness(db).fetch(new Request(
      'https://worker.test/api/nen-members/photos/photo-b/notification/retry',
      {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: ACCOUNT }),
      },
    ));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ data: { notificationStatus: 'sent', resent: true } });
    expect(line.calls).toHaveLength(1);
    expect(eventRow('photo-b')?.notification_status).toBe('sent');
  });
});
