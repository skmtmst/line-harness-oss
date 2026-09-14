/*
 * N-069: 許可された友だちのリマインダ登録・取消を staff が行えるようにする。
 *
 * 実SQLite（bootstrap.sql を流した better-sqlite3）に実物の reminders
 * ルートを当て、認証も実物（Bearer APIキー → staff_members → 役割・
 * permission_keys・account境界）で通す。外部送信は走らない。
 *
 * 直す前: POST /api/reminders/:id/enroll/:friendId と
 * DELETE /api/friend-reminders/:id は requireRole('owner','admin') のため、
 * /reminders 権限を持つ staff でも 403 で止まっていた。
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Env } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const TENANT = 'tenant-1';
const ACC_A = 'acc-a';
const ACC_B = 'acc-b';
const KEY_OWNER = 'key-owner-aaa';
const KEY_STAFF_A = 'key-staff-aaa';
const KEY_STAFF_B = 'key-staff-bbb';
const KEY_STAFF_NOPERM = 'key-staff-noperm';

const REMINDER_A = 'reminder-a';
const REMINDER_B = 'reminder-b';
const FRIEND_A = 'friend-a';
const FRIEND_B = 'friend-b';
const ENROLLMENT_A = 'enrollment-a';
const ENROLLMENT_B = 'enrollment-b';

function seed(sqlite: SqliteD1['raw']) {
  sqlite.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
  for (const id of [ACC_A, ACC_B]) {
    sqlite.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
       VALUES (?, ?, ?, 'token', 'secret', 'tenant-1')`,
    ).run(id, `channel-${id}`, id);
  }
  sqlite.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('owner-1', 'オーナー', 'owner', ?, 'tenant-1', 'all')`,
  ).run(KEY_OWNER);
  // /reminders・/friends 権限を持つ現場staff。見られるのは acc-a だけ。
  // （GET /api/friends/:id/reminders は /friends 鍵を見るため両方持たせる）
  sqlite.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope, permission_keys)
     VALUES ('staff-a', '担当A', 'staff', ?, 'tenant-1', 'accounts', '["/reminders","/friends"]')`,
  ).run(KEY_STAFF_A);
  sqlite.prepare(
    `INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
     VALUES ('staff-a', ?, '2026-09-01T00:00:00.000Z')`,
  ).run(ACC_A);
  // 同じく /reminders 権限を持つが、見られるのは acc-b だけ。
  sqlite.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope, permission_keys)
     VALUES ('staff-b', '担当B', 'staff', ?, 'tenant-1', 'accounts', '["/reminders"]')`,
  ).run(KEY_STAFF_B);
  sqlite.prepare(
    `INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
     VALUES ('staff-b', ?, '2026-09-01T00:00:00.000Z')`,
  ).run(ACC_B);
  // リマインダ権限を持たないstaff。認証middlewareの fail-closed が効くはず。
  sqlite.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('staff-noperm', '権限なし', 'staff', ?, 'tenant-1', 'all')`,
  ).run(KEY_STAFF_NOPERM);

  insertFriend(sqlite, FRIEND_A, { line_account_id: ACC_A });
  insertFriend(sqlite, FRIEND_B, { line_account_id: ACC_B });
  for (const [id, accountId] of [[REMINDER_A, ACC_A], [REMINDER_B, ACC_B]] as const) {
    sqlite.prepare(
      `INSERT INTO reminders (id, name, line_account_id, trigger_type, lifecycle_status)
       VALUES (?, ?, ?, 'manual', 'published')`,
    ).run(id, `リマインダ${id}`, accountId);
  }
  for (const [id, friendId, reminderId] of [
    [ENROLLMENT_A, FRIEND_A, REMINDER_A],
    [ENROLLMENT_B, FRIEND_B, REMINDER_B],
  ] as const) {
    sqlite.prepare(
      `INSERT INTO friend_reminders (id, friend_id, reminder_id, target_date, status)
       VALUES (?, ?, ?, '2026-10-01T10:00:00.000Z', 'active')`,
    ).run(id, friendId, reminderId);
  }
}

let sqlite: SqliteD1;
let remindersRoute: Awaited<typeof import('./reminders.js')>['reminders'];

function app() {
  const instance = new Hono<Env>();
  // 認証は実物。Bearer APIキー → staff_members → 役割・権限・account境界まで本番通り。
  instance.use('*', authMiddleware);
  instance.route('/', remindersRoute);
  return instance;
}

const env = () => ({ DB: sqlite.db }) as unknown as Env['Bindings'];

function enroll(reminderId: string, friendId: string, apiKey: string) {
  return app().request(`/api/reminders/${reminderId}/enroll/${friendId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ targetDate: '2026-10-05T10:00:00.000Z' }),
  }, env());
}

function cancelEnrollment(enrollmentId: string, apiKey: string) {
  return app().request(`/api/friend-reminders/${enrollmentId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}` },
  }, env());
}

function enrollmentStatus(id: string): string | null {
  const row = sqlite.raw
    .prepare(`SELECT status FROM friend_reminders WHERE id = ?`)
    .get(id) as { status: string } | undefined;
  return row?.status ?? null;
}

function enrollmentCount(): number {
  return (sqlite.raw.prepare(`SELECT COUNT(*) AS n FROM friend_reminders`).get() as { n: number }).n;
}

beforeEach(async () => {
  sqlite = createTestD1();
  seed(sqlite.raw);
  ({ reminders: remindersRoute } = await import('./reminders.js'));
});

describe('リマインダ登録・取消の staff 許可 (N-069)', () => {
  test('自分のアカウントの公開済みリマインダへ、staffが友だちを登録できる', async () => {
    const res = await enroll(REMINDER_A, FRIEND_A, KEY_STAFF_A);
    expect(res.status).toBe(201);
    const row = sqlite.raw
      .prepare(`SELECT status, source_kind FROM friend_reminders WHERE friend_id = ? AND reminder_id = ? AND status = 'active'`)
      .get(FRIEND_A, REMINDER_A) as { status: string; source_kind: string } | undefined;
    expect(row?.source_kind).toBe('manual');
  });

  test('自分のアカウントの登録を、staffが取消できる', async () => {
    const res = await cancelEnrollment(ENROLLMENT_A, KEY_STAFF_A);
    expect(res.status).toBe(200);
    expect(enrollmentStatus(ENROLLMENT_A)).toBe('cancelled');
  });

  test('ownerは従来どおり登録・取消できる', async () => {
    const enrolled = await enroll(REMINDER_A, FRIEND_A, KEY_OWNER);
    expect(enrolled.status).toBe(201);
    const cancelled = await cancelEnrollment(ENROLLMENT_A, KEY_OWNER);
    expect(cancelled.status).toBe(200);
    expect(enrollmentStatus(ENROLLMENT_A)).toBe('cancelled');
  });

  test('担当外アカウントのリマインダへは登録できず、行も増えない', async () => {
    const res = await enroll(REMINDER_A, FRIEND_A, KEY_STAFF_B);
    expect(res.status).toBe(404);
    expect(enrollmentCount()).toBe(2);
  });

  test('担当外アカウントの友だちは、自アカウントのリマインダへも登録できない', async () => {
    const res = await enroll(REMINDER_A, FRIEND_B, KEY_STAFF_A);
    expect(res.status).toBe(404);
    expect(enrollmentCount()).toBe(2);
  });

  test('担当外アカウントの登録行は取消できず、active のまま残る', async () => {
    const res = await cancelEnrollment(ENROLLMENT_A, KEY_STAFF_B);
    expect(res.status).toBe(404);
    expect(enrollmentStatus(ENROLLMENT_A)).toBe('active');
  });

  test('存在しない登録行の取消は404', async () => {
    const res = await cancelEnrollment('enrollment-missing', KEY_OWNER);
    expect(res.status).toBe(404);
  });

  test('/reminders 権限を持たない staff は middleware が 403 で止める', async () => {
    const enrolled = await enroll(REMINDER_A, FRIEND_A, KEY_STAFF_NOPERM);
    expect(enrolled.status).toBe(403);
    const cancelled = await cancelEnrollment(ENROLLMENT_A, KEY_STAFF_NOPERM);
    expect(cancelled.status).toBe(403);
    expect(enrollmentCount()).toBe(2);
    expect(enrollmentStatus(ENROLLMENT_A)).toBe('active');
  });

  test('他の管理口は staff のまま止まる（リマインダ作成・削除）', async () => {
    const created = await app().request('/api/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY_STAFF_A}` },
      body: JSON.stringify({ name: '作れないはず', lineAccountId: ACC_A, triggerType: 'manual' }),
    }, env());
    expect(created.status).toBe(403);
    const deleted = await app().request(`/api/reminders/${REMINDER_A}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${KEY_STAFF_A}` },
    }, env());
    expect(deleted.status).toBe(403);
    expect(enrollmentStatus(ENROLLMENT_A)).toBe('active');
  });

  test('読み取り口は従来どおり staff に開いている（一覧・友だちの登録一覧）', async () => {
    const list = await app().request('/api/reminders', {
      headers: { Authorization: `Bearer ${KEY_STAFF_A}` },
    }, env());
    expect(list.status).toBe(200);
    const byFriend = await app().request(`/api/friends/${FRIEND_A}/reminders`, {
      headers: { Authorization: `Bearer ${KEY_STAFF_A}` },
    }, env());
    expect(byFriend.status).toBe(200);
  });
});
