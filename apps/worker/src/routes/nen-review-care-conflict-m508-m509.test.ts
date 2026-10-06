import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const accountAccess = vi.hoisted(() => ({ canAccessAllLineAccounts: vi.fn(async () => true) }));
vi.mock('../services/account-access.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  canAccessAllLineAccounts: accountAccess.canAccessAllLineAccounts,
}));

// 通知のLINE送信だけ差し替え。保存の成否は実DBで見る。
const line = vi.hoisted(() => ({ push: vi.fn(async () => ({ requestId: 'req-1' })) }));
vi.mock('../services/line-proxy-send.js', () => ({ pushViaHarnessProxy: line.push }));

const { nenMembers } = await import('./nen-members.js');

/*
 * M508（写真審査の保存失敗が競合に化ける）・M509（見守りフラグの同時更新）
 * を実SQLiteで見る。
 *
 * M508: 保存のbatchが落ちたら、版の不一致でない限り500で返す。
 * 「ほかの担当者により更新されました」に化けない。
 * M509: 見守りフラグの更新に版（expectedUpdatedAt）を持たせ、古い画面から
 * の保存は409で止め、最新の状態を data.latest で返す。
 */

const ACCOUNT = 'account-a';
let testDb: SqliteD1;

function app(database: D1Database) {
  const instance = new Hono<any>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: 'staff-a', name: '担当者', role: 'staff', readOnly: false,
      permissionKeys: ['photo.submission.view', 'photo.submission.review'],
    });
    c.env = { DB: database, IMAGES: { get: vi.fn() }, WORKER_PUBLIC_URL: 'https://worker.test' };
    await next();
  });
  instance.route('/', nenMembers);
  return instance;
}

/** 特定のSQLのときだけ投げるD1。保存の途中失敗を作る。 */
function withFailure(base: D1Database, shouldFail: (query: string) => boolean, message: string): D1Database {
  return {
    prepare(query: string) {
      const statement = base.prepare(query);
      return {
        ...statement,
        bind(...bindings: unknown[]) {
          if (shouldFail(query)) {
            return {
              first: async () => { throw new Error(message); },
              all: async () => { throw new Error(message); },
              run: async () => { throw new Error(message); },
            } as unknown as D1PreparedStatement;
          }
          return statement.bind(...bindings);
        },
      } as unknown as D1PreparedStatement;
    },
    batch: (statements: D1PreparedStatement[]) => base.batch(statements),
  } as unknown as D1Database;
}

function seed() {
  const raw = testDb.raw;
  raw.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-a', 'channel-a', 'A店', 'token-a', 'secret-a');
    INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following, created_at, updated_at)
    VALUES ('friend-a', 'U-friend-a', 'Aさん', 'account-a', 1, '2026-09-01', '2026-09-01');
    INSERT INTO nen_pet_profiles (id, friend_id, name, created_at, updated_at)
    VALUES ('pet-a', 'friend-a', 'ハナ', '2026-09-01', '2026-09-01');
    INSERT INTO nen_photo_submissions
      (id, friend_id, pet_id, r2_key, image_url, content_type, status, created_at,
       reviewed_at, updated_at, line_account_id, review_image_url, public_image_url, review_version)
    VALUES ('photo-1', 'friend-a', 'pet-a', 'original/photo-1.jpg', 'legacy-photo-1', 'image/jpeg', 'pending',
      '2026-09-01T00:00:00.000Z', NULL, '2026-09-01T00:00:00.000Z', 'account-a',
      'https://cdn.test/photo-1.jpg', NULL, 1);
    INSERT INTO media_file_scans
      (id, line_account_id, subject_kind, subject_id, filename, mime_type,
       size_bytes, status, scanned_at, created_at, updated_at)
    VALUES ('scan-1', 'account-a', 'photo', 'photo-1', 'photo-1.jpg', 'image/jpeg',
      100, 'clean', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');
    INSERT INTO nen_care_flags
      (id, pet_id, friend_id, flag_type, status, consecutive_days, advice_ready, detected_at, resolved_at, updated_at)
    VALUES ('flag-1', 'pet-a', 'friend-a', 'poor_appetite', 'active', 3, 1, '2026-09-01', NULL, '2026-09-01T00:00:00.000+09:00');
  `);
}

const REVIEW_KEY = '123e4567-e89b-42d3-a456-426614174001';

function reviewRequest(photoId: string, expectedVersion: number, key = REVIEW_KEY, extra: Record<string, unknown> = {}) {
  return new Request(`https://worker.test/api/nen-members/photos/${photoId}/review`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({
      accountId: ACCOUNT, status: 'rejected', reasonCode: 'quality', reasonNote: '',
      expectedVersion, ...extra,
    }),
  });
}

function photoStatus(photoId = 'photo-1'): { status: string; review_version: number } {
  return testDb.raw.prepare(
    `SELECT status, review_version FROM nen_photo_submissions WHERE id = ?`,
  ).get(photoId) as { status: string; review_version: number };
}

beforeEach(() => {
  testDb = createTestD1();
  seed();
  accountAccess.canAccessAllLineAccounts.mockResolvedValue(true);
  line.push.mockClear();
});

describe('M508 保存の失敗は競合に化けず500で理由が分かる', () => {
  it('保存の途中で落ちたら「保存できませんでした」で500になり、写真は審査待ちのまま', async () => {
    const failing = withFailure(
      testDb.db,
      (query) => query.includes('INSERT INTO nen_photo_review_events'),
      'D1_ERROR: simulated mid-save failure',
    );
    const response = await app(failing).request(reviewRequest('photo-1', 1));
    expect(response.status).toBe(500);
    const body = (await response.json()) as { success: boolean; code: string; error: string };
    expect(body.code).toBe('REVIEW_SAVE_FAILED');
    expect(body.error).toContain('保存できませんでした');
    // 「ほかの担当者」に化けていない。
    expect(body.error).not.toContain('ほかの担当者');
    expect(photoStatus()).toEqual({ status: 'pending', review_version: 1 });
  });

  it('制約違反で落ちても競合に化けず500になる', async () => {
    const failing = withFailure(
      testDb.db,
      (query) => query.includes('INSERT INTO nen_photo_review_events'),
      'UNIQUE constraint failed: nen_photo_review_events.id',
    );
    const response = await app(failing).request(reviewRequest('photo-1', 1));
    expect(response.status).toBe(500);
    const body = (await response.json()) as { success: boolean; code: string; error: string };
    expect(body.code).toBe('REVIEW_SAVE_FAILED');
    expect(photoStatus()).toEqual({ status: 'pending', review_version: 1 });
  });

  it('本物の版の不一致は409のまま（codeつき）', async () => {
    const response = await app(testDb.db).request(reviewRequest('photo-1', 99));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { success: boolean; code: string };
    expect(body.code).toBe('VERSION_CONFLICT');
  });

  it('見送りの保存は通る（回帰なし）', async () => {
    const response = await app(testDb.db).request(reviewRequest('photo-1', 1));
    expect(response.status).toBe(200);
    expect(photoStatus()).toEqual({ status: 'rejected', review_version: 2 });
  });
});

describe('M509 見守りフラグの同時更新は古い画面からを409で止める', () => {
  function flagRow() {
    return testDb.raw.prepare(
      `SELECT status, updated_at FROM nen_care_flags WHERE id = 'flag-1'`,
    ).get() as { status: string; updated_at: string };
  }

  it('版を送らない従来の更新はそのまま通る', async () => {
    const response = await app(testDb.db).request('https://worker.test/api/nen-members/care-flags/flag-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved', adviceReady: true }),
    });
    expect(response.status).toBe(200);
    expect(flagRow().status).toBe('resolved');
  });

  it('合っている版は通り、古い版は最新の状態つきで409になる', async () => {
    const first = await app(testDb.db).request('https://worker.test/api/nen-members/care-flags/flag-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved', adviceReady: true, expectedUpdatedAt: '2026-09-01T00:00:00.000+09:00' }),
    });
    expect(first.status).toBe(200);
    const saved = flagRow();

    const stale = await app(testDb.db).request('https://worker.test/api/nen-members/care-flags/flag-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active', adviceReady: true, expectedUpdatedAt: '2026-09-01T00:00:00.000+09:00' }),
    });
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as {
      success: boolean; code: string; data: { latest: { status: string; updatedAt: string } };
    };
    expect(body.code).toBe('VERSION_CONFLICT');
    expect(body.data.latest.status).toBe(saved.status);
    expect(body.data.latest.updatedAt).toBe(saved.updated_at);
    // 先の変更（解決）が黙って消えていない。
    expect(flagRow().status).toBe('resolved');
  });
});
