import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import {
  applyBulkPhotoDecisions,
  type BulkPhotoDecision,
} from '@line-crm/db';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';

/*
 * #817: 写真の重複と報酬の決まりの版。実DBで確かめる。
 *
 * - 完全に同じ写真は中身の hash で「重複」とする。似ている写真は
 *   自動で却下しない（注意の札だけ）。
 * - 前の投稿が採用済みのときは「却下」か「報酬なしで採用」。
 *   同じ写真が2回採用されても、報酬は1回だけ。
 * - 報酬の決まりは版を持つ。保存するたびに版を1つ足し、前の版は変えない。
 *   採用した時点の版を付与の記録に写す。版を変えても過去の付与は変わらない。
 */

vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
  getVisibleLineAccountScope: vi.fn(),
}));
// 検査の門番は通す。門番自体は file-scan の試験で見る。
vi.mock('../services/file-scan.js', () => ({
  getFileScanBySubject: vi.fn(async () => ({ status: 'clean' })),
  runBuiltinScanAndStore: vi.fn(),
  runScanForStoredObject: vi.fn(),
}));
// 投稿者へのLINE通知は外へ出さない。失敗しても審査自体は残る。
vi.mock('../services/line-proxy-send.js', () => ({ pushViaHarnessProxy: vi.fn(async () => ({ ok: true })) }));
vi.mock('../services/local-line-proxy.js', () => ({ dispatchLineProxyLocally: vi.fn() }));
vi.mock('../services/nen-tag-sync.js', () => ({ syncNenPhotoTags: vi.fn(async () => {}) }));

const { nenMembers } = await import('./nen-members.js');
const { nenPhotoOperations } = await import('./nen-photo-operations.js');

const NOW = '2026-09-21T00:00:00.000+09:00';
const OWNER = { id: 'owner-1', name: '管理者', role: 'owner', readOnly: false };

type TestEnv = {
  Bindings: { DB: D1Database };
  Variables: { staff: Record<string, unknown> };
};

function app(db: D1Database, staff: Record<string, unknown> = OWNER) {
  const target = new Hono<TestEnv>();
  target.use('*', async (c, next) => {
    c.set('staff', staff);
    c.env = { DB: db };
    await next();
  });
  target.route('/', nenMembers);
  target.route('/', nenPhotoOperations);
  return target;
}

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
  input: {
    id: string;
    friendId?: string;
    status?: 'pending' | 'adopted' | 'rejected';
    awardedPoints?: number;
    contentHash?: string | null;
    customerId?: string | null;
  },
): void {
  const friendId = input.friendId ?? 'friend-a';
  insertPet(raw, `pet-${input.id}`, friendId);
  raw.prepare(
    `INSERT INTO nen_photo_submissions
      (id, friend_id, pet_id, r2_key, image_url, content_type, caption, status,
       awarded_points, content_hash, created_at, updated_at, line_account_id)
     VALUES (?, ?, ?, ?, ?, 'image/jpeg', '', ?, ?, ?, ?, ?, 'account-a')`,
  ).run(
    input.id, friendId, `pet-${input.id}`,
    `photos/${input.id}.jpg`, `https://img/${input.id}.jpg`,
    input.status ?? 'pending', input.awardedPoints ?? 0,
    input.contentHash ?? null, NOW, NOW,
  );
  if (input.customerId !== undefined) {
    raw.prepare(
      `INSERT INTO nen_ec_member_snapshots (friend_id, customer_id, synced_at)
       VALUES (?, ?, ?)
       ON CONFLICT(friend_id) DO UPDATE SET customer_id = excluded.customer_id`,
    ).run(friendId, input.customerId, NOW);
  }
}

function insertSafeRisk(raw: Database.Database, photoId: string): void {
  raw.prepare(
    `INSERT INTO nen_photo_risk_assessments
      (id, photo_id, line_account_id, flag, assessed_at, created_at)
     VALUES (?, ?, 'account-a', 'safe', ?, ?)`,
  ).run(`risk-${photoId}`, photoId, NOW, NOW);
}

function outboxRows(raw: Database.Database, photoId: string) {
  return raw.prepare(
    `SELECT policy_version, points FROM nen_photo_reward_outbox WHERE photo_id = ?`,
  ).all(photoId) as Array<{ policy_version: string; points: number }>;
}

const putReview = (
  target: ReturnType<typeof app>,
  id: string,
  body: Record<string, unknown>,
  key = `key-${id}-${Math.random()}`,
) => target.request(`/api/nen-members/photos/${id}/review`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
  body: JSON.stringify({ accountId: 'account-a', expectedVersion: 1, ...body }),
});

describe('#817 報酬の決まりの版', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    insertAccount(testDb.raw, 'account-a');
    insertFriend(testDb.raw, 'friend-a', { line_account_id: 'account-a' });
  });
  afterEach(() => { testDb.raw.close(); });

  it('最初から第1版（5pt・使用中）が1つだけある', async () => {
    const res = await app(testDb.db).request('/api/nen-members/photo-reward-policy/versions');
    expect(res.status).toBe(200);
    const json = await res.json() as {
      data: Array<{ versionNumber: number; policyKey: string; points: number; status: string }>;
    };
    expect(json.data).toHaveLength(1);
    expect(json.data[0]).toMatchObject({
      versionNumber: 1, policyKey: 'legacy-5', points: 5, status: 'in_use',
    });
  });

  it('保存するたびに版が足され、前の版は変わらない', async () => {
    const target = app(testDb.db);
    const created = await target.request('/api/nen-members/photo-reward-policy/versions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'policy-key-1' },
      body: JSON.stringify({ points: 10, summary: '報酬を5pt→10ptに' }),
    });
    expect(created.status).toBe(200);
    const createdJson = await created.json() as {
      data: { created: boolean; version: { versionNumber: number; policyKey: string; points: number } };
    };
    expect(createdJson.data.created).toBe(true);
    expect(createdJson.data.version).toMatchObject({ versionNumber: 2, policyKey: 'v2', points: 10 });

    const list = await (await target.request('/api/nen-members/photo-reward-policy/versions')).json() as {
      data: Array<{ versionNumber: number; points: number; summary: string; status: string }>;
    };
    expect(list.data.map((v) => [v.versionNumber, v.points, v.status])).toEqual([
      [2, 10, 'in_use'],
      [1, 5, 'past'],
    ]);
    // 第1版の中身は変わらない。
    expect(list.data.find((v) => v.versionNumber === 1)?.summary).toBe('最初の報酬の決まり');
  });

  it('同じ確認キーの再送では版が増えない', async () => {
    const target = app(testDb.db);
    const payload = { points: 10, summary: '報酬を5pt→10ptに' };
    const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': 'same-key' };
    const first = await target.request('/api/nen-members/photo-reward-policy/versions', {
      method: 'POST', headers, body: JSON.stringify(payload),
    });
    expect(first.status).toBe(200);
    const second = await target.request('/api/nen-members/photo-reward-policy/versions', {
      method: 'POST', headers, body: JSON.stringify(payload),
    });
    const secondJson = await second.json() as { data: { created: boolean } };
    expect(secondJson.data.created).toBe(false);
    const list = await (await target.request('/api/nen-members/photo-reward-policy/versions')).json() as {
      data: Array<unknown>;
    };
    expect(list.data).toHaveLength(2);
  });

  it('未来の使い始めは予約、過ぎた版が使用中', async () => {
    const target = app(testDb.db);
    await target.request('/api/nen-members/photo-reward-policy/versions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'policy-future' },
      body: JSON.stringify({ points: 20, summary: '来月から20pt', effectiveFrom: '2999-10-01T00:00:00+09:00' }),
    });
    const list = await (await target.request('/api/nen-members/photo-reward-policy/versions')).json() as {
      data: Array<{ versionNumber: number; status: string }>;
    };
    expect(list.data.map((v) => [v.versionNumber, v.status])).toEqual([
      [2, 'reserved'],
      [1, 'in_use'],
    ]);
  });

  it('この版に戻す：過去の中身で新しい版ができる。過去は変わらない', async () => {
    const target = app(testDb.db);
    await target.request('/api/nen-members/photo-reward-policy/versions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'policy-v2' },
      body: JSON.stringify({ points: 10, summary: '報酬を5pt→10ptに' }),
    });
    const reverted = await target.request('/api/nen-members/photo-reward-policy/revert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'policy-revert-1' },
      body: JSON.stringify({ versionNumber: 1 }),
    });
    expect(reverted.status).toBe(200);
    const revertedJson = await reverted.json() as {
      data: { version: { versionNumber: number; points: number; summary: string } };
    };
    expect(revertedJson.data.version).toMatchObject({
      versionNumber: 3, points: 5, summary: '最初の報酬の決まり',
    });
    const v2 = testDb.raw.prepare(
      `SELECT points, summary FROM photo_reward_policies WHERE version_number = 2`,
    ).get() as { points: number; summary: string };
    expect(v2).toMatchObject({ points: 10, summary: '報酬を5pt→10ptに' });
  });

  it('古い版確認での保存は409で止まり、上書きしない', async () => {
    const target = app(testDb.db);
    const headers = (key: string) => ({ 'Content-Type': 'application/json', 'Idempotency-Key': key });
    await target.request('/api/nen-members/photo-reward-policy/versions', {
      method: 'POST', headers: headers('conflict-first'),
      body: JSON.stringify({ points: 10, expectedVersion: 1 }),
    });
    const stale = await target.request('/api/nen-members/photo-reward-policy/versions', {
      method: 'POST', headers: headers('conflict-stale'),
      body: JSON.stringify({ points: 20, expectedVersion: 1 }),
    });
    expect(stale.status).toBe(409);
    const list = await (await target.request('/api/nen-members/photo-reward-policy/versions')).json() as {
      data: Array<{ versionNumber: number; points: number }>;
    };
    expect(list.data.map((v) => [v.versionNumber, v.points])).toEqual([[2, 10], [1, 5]]);
  });

  it('点数が範囲外・確認キーなし・無い版は受け付けない', async () => {
    const target = app(testDb.db);
    const badPoints = await target.request('/api/nen-members/photo-reward-policy/versions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'bad-points' },
      body: JSON.stringify({ points: 0 }),
    });
    expect(badPoints.status).toBe(400);
    const noKey = await target.request('/api/nen-members/photo-reward-policy/versions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: 10 }),
    });
    expect(noKey.status).toBe(400);
    const missing = await target.request('/api/nen-members/photo-reward-policy/revert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'missing-version' },
      body: JSON.stringify({ versionNumber: 99 }),
    });
    expect(missing.status).toBe(404);
  });

  it('owner・admin以外は変えられないが、一覧は見られる', async () => {
    const staff = {
      id: 'staff-1', name: '担当', role: 'staff', readOnly: false,
      permissionKeys: ['photo.submission.view'],
    };
    const target = app(testDb.db, staff);
    const list = await target.request('/api/nen-members/photo-reward-policy/versions');
    expect(list.status).toBe(200);
    const created = await target.request('/api/nen-members/photo-reward-policy/versions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'staff-key' },
      body: JSON.stringify({ points: 10 }),
    });
    expect(created.status).toBe(403);
    const reverted = await target.request('/api/nen-members/photo-reward-policy/revert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'staff-revert' },
      body: JSON.stringify({ versionNumber: 1 }),
    });
    expect(reverted.status).toBe(403);
  });
});

describe('#817 写真の重複と報酬', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    insertAccount(testDb.raw, 'account-a');
    insertFriend(testDb.raw, 'friend-a', { line_account_id: 'account-a' });
  });
  afterEach(() => { testDb.raw.close(); });

  it('重複の詳細には前の採用済みの投稿が並ぶ', async () => {
    insertPhoto(testDb.raw, {
      id: 'photo-old', status: 'adopted', awardedPoints: 5, contentHash: 'hash-same',
    });
    insertPhoto(testDb.raw, { id: 'photo-new', status: 'pending', contentHash: 'hash-same' });
    const res = await app(testDb.db).request('/api/nen-members/photos/photo-new?accountId=account-a');
    expect(res.status).toBe(200);
    const json = await res.json() as {
      data: { duplicate: { photoId: string; awardedPoints: number } | null };
    };
    expect(json.data.duplicate?.photoId).toBe('photo-old');
    expect(json.data.duplicate?.awardedPoints).toBe(5);
  });

  it('hashが違う・hashが無い投稿は重複にならない', async () => {
    insertPhoto(testDb.raw, {
      id: 'photo-old', status: 'adopted', awardedPoints: 5, contentHash: 'hash-a',
    });
    insertPhoto(testDb.raw, { id: 'photo-diff', status: 'pending', contentHash: 'hash-b' });
    insertPhoto(testDb.raw, { id: 'photo-nohash', status: 'pending' });
    const target = app(testDb.db);
    for (const id of ['photo-diff', 'photo-nohash']) {
      const res = await target.request(`/api/nen-members/photos/${id}?accountId=account-a`);
      expect(res.status).toBe(200);
      const json = await res.json() as { data: { duplicate: unknown } };
      expect(json.data.duplicate).toBeNull();
    }
  });

  it('採用はその時点の版の点数・鍵を付与の記録に写す', async () => {
    insertPhoto(testDb.raw, { id: 'photo-1', status: 'pending', contentHash: 'hash-1', customerId: '12345' });
    const res = await putReview(app(testDb.db), 'photo-1', { status: 'adopted' });
    expect(res.status).toBe(200);
    const json = await res.json() as {
      data: { awardedPoints: number; rewardSkipped: string | null };
    };
    expect(json.data.awardedPoints).toBe(5);
    expect(json.data.rewardSkipped).toBeNull();
    expect(outboxRows(testDb.raw, 'photo-1')).toEqual([{ policy_version: 'legacy-5', points: 5 }]);
  });

  it('同じ写真が2回採用されても報酬は1回だけ', async () => {
    insertPhoto(testDb.raw, {
      id: 'photo-old', status: 'adopted', awardedPoints: 5, contentHash: 'hash-same', customerId: '12345',
    });
    testDb.raw.prepare(
      `INSERT INTO nen_photo_reward_outbox
        (id, photo_id, line_account_id, friend_id, customer_id, provider_award_key,
         policy_version, points, status, created_at, updated_at)
       VALUES ('reward-old', 'photo-old', 'account-a', 'friend-a', '12345',
         'nen-photo:photo-old', 'legacy-5', 5, 'synced', ?, ?)`,
    ).run(NOW, NOW);
    insertPhoto(testDb.raw, { id: 'photo-new', status: 'pending', contentHash: 'hash-same', customerId: '12345' });
    const res = await putReview(app(testDb.db), 'photo-new', { status: 'adopted' });
    expect(res.status).toBe(200);
    const json = await res.json() as {
      data: { awardedPoints: number; rewardSkipped: string | null };
    };
    // 採用自体は残るが、点数は付かない。
    expect(json.data.awardedPoints).toBe(0);
    expect(json.data.rewardSkipped).toBe('duplicate');
    const status = testDb.raw.prepare(
      `SELECT status, awarded_points FROM nen_photo_submissions WHERE id = 'photo-new'`,
    ).get() as { status: string; awarded_points: number };
    expect(status).toMatchObject({ status: 'adopted', awarded_points: 0 });
    expect(outboxRows(testDb.raw, 'photo-new')).toEqual([]);
  });

  it('報酬なしで採用は点数を付けず採用だけ残す', async () => {
    insertPhoto(testDb.raw, { id: 'photo-1', status: 'pending', contentHash: 'hash-9', customerId: '12345' });
    const res = await putReview(app(testDb.db), 'photo-1', { status: 'adopted', withoutReward: true });
    expect(res.status).toBe(200);
    const json = await res.json() as {
      data: { awardedPoints: number; rewardSkipped: string | null };
    };
    expect(json.data.awardedPoints).toBe(0);
    expect(json.data.rewardSkipped).toBe('requested');
    expect(outboxRows(testDb.raw, 'photo-1')).toEqual([]);
  });

  it('版を変えても過去の付与は変わらず、新しい採用から新しい版を見る', async () => {
    insertPhoto(testDb.raw, { id: 'photo-old', status: 'pending', contentHash: 'hash-old', customerId: '12345' });
    await putReview(app(testDb.db), 'photo-old', { status: 'adopted' });
    expect(outboxRows(testDb.raw, 'photo-old')).toEqual([{ policy_version: 'legacy-5', points: 5 }]);

    const target = app(testDb.db);
    await target.request('/api/nen-members/photo-reward-policy/versions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'policy-10pt' },
      body: JSON.stringify({ points: 10, summary: '報酬を5pt→10ptに' }),
    });
    insertPhoto(testDb.raw, { id: 'photo-new', status: 'pending', contentHash: 'hash-new', customerId: '12345' });
    const res = await putReview(target, 'photo-new', { status: 'adopted' });
    const json = await res.json() as { data: { awardedPoints: number } };
    expect(json.data.awardedPoints).toBe(10);
    expect(outboxRows(testDb.raw, 'photo-new')).toEqual([{ policy_version: 'v2', points: 10 }]);
    // 過去の付与は変わらない。
    expect(outboxRows(testDb.raw, 'photo-old')).toEqual([{ policy_version: 'legacy-5', points: 5 }]);
  });

  it('一括採用も版の点数を使い、重複は報酬なし', async () => {
    insertPhoto(testDb.raw, {
      id: 'photo-old', status: 'adopted', awardedPoints: 5, contentHash: 'hash-same', customerId: '12345',
    });
    insertPhoto(testDb.raw, { id: 'photo-b1', status: 'pending', contentHash: 'hash-same', customerId: '12345' });
    insertPhoto(testDb.raw, { id: 'photo-b2', status: 'pending', contentHash: 'hash-fresh', customerId: '12345' });
    insertSafeRisk(testDb.raw, 'photo-b1');
    insertSafeRisk(testDb.raw, 'photo-b2');
    const decisions: BulkPhotoDecision[] = [
      { photoId: 'photo-b1', decision: 'approve', expectedVersion: 1, reasonCode: null, reasonNote: null },
      { photoId: 'photo-b2', decision: 'approve', expectedVersion: 1, reasonCode: null, reasonNote: null },
    ];
    const outcome = await applyBulkPhotoDecisions(testDb.db, {
      id: 'bulk-1',
      lineAccountId: 'account-a',
      actorId: 'owner-1',
      actorName: '管理者',
      idempotencyKey: 'bulk-key-1',
      requestFingerprint: 'fp-1',
      decisions,
      now: NOW,
    });
    expect(outcome.kind).toBe('created');
    const awarded = (photoId: string) => (testDb.raw.prepare(
      `SELECT awarded_points FROM nen_photo_submissions WHERE id = ?`,
    ).get(photoId) as { awarded_points: number }).awarded_points;
    expect(awarded('photo-b1')).toBe(0);
    expect(awarded('photo-b2')).toBe(5);
    expect(outboxRows(testDb.raw, 'photo-b1')).toEqual([]);
    expect(outboxRows(testDb.raw, 'photo-b2')).toEqual([{ policy_version: 'legacy-5', points: 5 }]);
  });
});
