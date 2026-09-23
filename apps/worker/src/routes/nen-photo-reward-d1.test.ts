import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { nenMembers } from './nen-members.js';

/*
 * PHOTO-06 (#1079): 止まったポイント手続きの復旧口（point-retry /
 * point-reconcile）と、詳細応答の派生状態を実DBで確かめる。
 */

const NOW = '2026-09-21T00:00:00.000+09:00';
const OLD = '2026-08-10T00:00:00.000+09:00';
const SECRET = 's'.repeat(40);

type TestEnv = {
  Bindings: { DB: D1Database; NEN_EC_BASE_URL?: string; ECCUBE_WEBHOOK_SECRET?: string };
  Variables: { staff: Record<string, unknown> };
};

function insertAccount(raw: Database.Database, id: string): void {
  raw.prepare(
    `INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, is_active, line_basic_id)
     VALUES (?, ?, ?, 'token', 'secret', 1, ?)`,
  ).run(id, `channel-${id}`, id, `@${id}`);
}

function insertPet(raw: Database.Database, id: string, friendId: string): void {
  raw.prepare(
    `INSERT INTO nen_pet_profiles
      (id, friend_id, name, animal_type, created_at, updated_at)
     VALUES (?, ?, 'pet', 'dog', ?, ?)`,
  ).run(id, friendId, NOW, NOW);
}

function insertPhoto(
  raw: Database.Database,
  input: { id: string; friendId?: string; status?: 'pending' | 'adopted' | 'rejected'; customerId?: string | null },
): void {
  raw.prepare(
    `INSERT INTO nen_photo_submissions
      (id, friend_id, pet_id, r2_key, image_url, content_type, caption, status,
       created_at, updated_at, line_account_id)
     VALUES (?, ?, ?, ?, ?, 'image/jpeg', '', ?, ?, ?, 'account-a')`,
  ).run(
    input.id, input.friendId ?? 'friend-a', `pet-${input.id}`,
    `photos/${input.id}.jpg`, `https://img/${input.id}.jpg`,
    input.status ?? 'adopted', NOW, NOW,
  );
  if (input.customerId !== undefined) {
    // EC会員との連携は friends ではなく nen_ec_member_snapshots にある。
    raw.prepare(
      `INSERT INTO nen_ec_member_snapshots (friend_id, customer_id, synced_at)
       VALUES (?, ?, ?)
       ON CONFLICT(friend_id) DO UPDATE SET customer_id = excluded.customer_id`,
    ).run(input.friendId ?? 'friend-a', input.customerId, NOW);
  }
}

function insertReward(
  raw: Database.Database,
  input: { photoId: string; status?: string; lastError?: string | null; nextAttemptAt?: string | null; updatedAt?: string },
): void {
  raw.prepare(
    `INSERT INTO nen_photo_reward_outbox
      (id, photo_id, line_account_id, friend_id, customer_id, provider_award_key,
       policy_version, points, status, attempt_count, last_error, next_attempt_at,
       created_at, updated_at)
     VALUES (?, ?, 'account-a', 'friend-a', '12345', ?, 'legacy-5', 5, ?, 0, ?, ?, ?, ?)`,
  ).run(
    `reward-${input.photoId}`, input.photoId, `nen-photo:${input.photoId}`,
    input.status ?? 'pending', input.lastError ?? null,
    input.nextAttemptAt ?? null, input.updatedAt ?? NOW, input.updatedAt ?? NOW,
  );
}

function app(db: D1Database, options: { ec?: boolean; staff?: Record<string, unknown> } = {}) {
  const target = new Hono<TestEnv>();
  target.use('*', async (c, next) => {
    c.set('staff', options.staff ?? { id: 'owner-1', name: '管理者', role: 'owner', readOnly: false });
    c.env = {
      DB: db,
      ...(options.ec ? { NEN_EC_BASE_URL: 'https://ec.example', ECCUBE_WEBHOOK_SECRET: SECRET } : {}),
    };
    await next();
  });
  target.route('/', nenMembers);
  return target;
}

const post = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('PHOTO-06: ポイント手続きの復旧口（実DB）', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    insertAccount(testDb.raw, 'account-a');
    insertFriend(testDb.raw, 'friend-a', { line_account_id: 'account-a' });
    insertPet(testDb.raw, 'pet-photo-1', 'friend-a');
  });
  afterEach(() => { vi.unstubAllGlobals(); testDb.raw.close(); });

  it('point-retry: 止まった行をECへ届けて synced にする', async () => {
    insertPhoto(testDb.raw, { id: 'photo-1', customerId: '12345' });
    insertReward(testDb.raw, { photoId: 'photo-1', updatedAt: OLD });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, pointBalance: 125 }), { status: 200 })));
    const target = app(testDb.db, { ec: true });
    const res = await target.request('/api/nen-members/photos/photo-1/point-retry', post({ accountId: 'account-a' }));
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: { synced: boolean; state: string; duplicate: boolean } };
    expect(json.data.synced).toBe(true);
    expect(json.data.state).toBe('synced');
    const row = testDb.raw.prepare(`SELECT status, attempt_count, synced_at FROM nen_photo_reward_outbox WHERE photo_id = 'photo-1'`).get() as { status: string; attempt_count: number; synced_at: string | null };
    expect(row.status).toBe('synced');
    expect(row.attempt_count).toBe(1);
    expect(row.synced_at).not.toBeNull();
  });

  it('point-reconcile: EC付与済み・管理DB未反映の食い違いを synced に収束させる', async () => {
    insertPhoto(testDb.raw, { id: 'photo-1', customerId: '12345' });
    insertReward(testDb.raw, { photoId: 'photo-1', updatedAt: OLD });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, duplicate: true, pointBalance: 125 }), { status: 200 })));
    const target = app(testDb.db, { ec: true });
    const res = await target.request('/api/nen-members/photos/photo-1/point-reconcile', post({ accountId: 'account-a' }));
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: { synced: boolean; duplicate: boolean } };
    expect(json.data.synced).toBe(true);
    expect(json.data.duplicate).toBe(true);
    expect((testDb.raw.prepare(`SELECT status FROM nen_photo_reward_outbox WHERE photo_id = 'photo-1'`).get() as { status: string }).status).toBe('synced');
  });

  it('point-retry: EC接続が未設定なら 503（行は変えない）', async () => {
    insertPhoto(testDb.raw, { id: 'photo-1', customerId: '12345' });
    insertReward(testDb.raw, { photoId: 'photo-1' });
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const target = app(testDb.db);
    const res = await target.request('/api/nen-members/photos/photo-1/point-retry', post({ accountId: 'account-a' }));
    expect(res.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
    expect((testDb.raw.prepare(`SELECT status FROM nen_photo_reward_outbox WHERE photo_id = 'photo-1'`).get() as { status: string }).status).toBe('pending');
  });

  it('point-retry: 採用前の写真・outbox行のない写真は受け付けない（再付与しない）', async () => {
    insertPhoto(testDb.raw, { id: 'photo-pending', status: 'pending' });
    // EC会員とつながった採用だが outbox 行が無い（旧経路）→ 勝手に作らない。
    insertPhoto(testDb.raw, { id: 'photo-no-reward', customerId: '12345' });
    const target = app(testDb.db, { ec: true });
    const res1 = await target.request('/api/nen-members/photos/photo-pending/point-retry', post({ accountId: 'account-a' }));
    expect(res1.status).toBe(400);
    const res2 = await target.request('/api/nen-members/photos/photo-no-reward/point-retry', post({ accountId: 'account-a' }));
    expect(res2.status).toBe(404);
    // 行は勝手に作られない。
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS c FROM nen_photo_reward_outbox WHERE photo_id = 'photo-no-reward'`).get() as { c: number }).toMatchObject({ c: 0 });
  });

  it('権限のない staff は復旧操作を拒否される', async () => {
    insertPhoto(testDb.raw, { id: 'photo-1' });
    insertReward(testDb.raw, { photoId: 'photo-1' });
    const target = app(testDb.db, {
      ec: true,
      staff: { id: 'staff-1', name: '担当', role: 'staff', readOnly: false, permissionKeys: ['photo.submission.review'] },
    });
    const res = await target.request('/api/nen-members/photos/photo-1/point-retry', post({ accountId: 'account-a' }));
    expect(res.status).toBe(403);
  });

  it('photo.reward.reconcile を持つ staff は復旧操作できる', async () => {
    insertPhoto(testDb.raw, { id: 'photo-1', customerId: '12345' });
    insertReward(testDb.raw, { photoId: 'photo-1' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })));
    const target = app(testDb.db, {
      ec: true,
      staff: { id: 'staff-1', name: '担当', role: 'staff', readOnly: false, permissionKeys: ['photo.reward.reconcile'] },
    });
    const res = await target.request('/api/nen-members/photos/photo-1/point-retry', post({ accountId: 'account-a' }));
    expect(res.status).toBe(200);
  });

  it('詳細応答の reward に派生状態と理由ラベルが乗る', async () => {
    insertPhoto(testDb.raw, { id: 'photo-1' });
    insertReward(testDb.raw, { photoId: 'photo-1', updatedAt: OLD });
    const target = app(testDb.db);
    const res = await target.request('/api/nen-members/photos/photo-1?accountId=account-a');
    expect(res.status).toBe(200);
    const json = await res.json() as { data: { reward: { state: string; status: string } } };
    expect(json.data.reward.status).toBe('pending');
    expect(json.data.reward.state).toBe('stale');
  });

  it('失敗行は理由ラベルつきで返す', async () => {
    insertPhoto(testDb.raw, { id: 'photo-1' });
    insertReward(testDb.raw, { photoId: 'photo-1', status: 'failed', lastError: 'customer_unlinked' });
    const target = app(testDb.db);
    const res = await target.request('/api/nen-members/photos/photo-1?accountId=account-a');
    const json = await res.json() as { data: { reward: { state: string; reason_label: string } } };
    expect(json.data.reward.state).toBe('failed_permanent');
    expect(json.data.reward.reason_label).toBe('EC会員との連携が外れています');
  });
});
