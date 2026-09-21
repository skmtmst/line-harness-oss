import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { nenMembers } from './nen-members.js';

/*
 * Issue #1040（IDEA-22 写真審査）の実DB契約。
 * 「撤回後に残る公開先・対応状況を追え」「採用1回に対し付与1回」を、
 * 実SQLに当てて確認する。fakeの準備関数では SQL そのものを検証できないため、
 * ここでは better-sqlite3 上の bootstrap スキーマへ投げる。
 */

const NOW = '2026-09-21T00:00:00.000Z';

function insertAccount(testDb: SqliteD1, id: string): void {
  testDb.raw.prepare(
    `INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, is_active, line_basic_id)
     VALUES (?, ?, ?, 'token', 'secret', 1, ?)`,
  ).run(id, `channel-${id}`, id, `@${id}`);
}

function insertPet(testDb: SqliteD1, id: string, friendId: string): void {
  testDb.raw.prepare(
    `INSERT INTO nen_pet_profiles
      (id, friend_id, name, animal_type, created_at, updated_at)
     VALUES (?, ?, ?, 'dog', ?, ?)`,
  ).run(id, friendId, `${id} name`, NOW, NOW);
}

function insertPhoto(
  testDb: SqliteD1,
  input: {
    id: string;
    status?: 'pending' | 'adopted' | 'rejected';
    consentAt?: string | null;
    consentWithdrawnAt?: string | null;
    awardedPoints?: number;
    reviewedByName?: string;
  },
): void {
  const consentAt = input.consentAt === undefined ? NOW : input.consentAt;
  testDb.raw.prepare(
    `INSERT INTO nen_photo_submissions
      (id, friend_id, pet_id, r2_key, image_url, review_image_url, public_image_url,
       content_type, caption, status, awarded_points, created_at, reviewed_at, updated_at,
       line_account_id, publication_consent_version, publication_consent_at,
       publication_withdrawn_at, public_pet_name, reviewed_by_name)
     VALUES (?, 'friend-a', 'pet-a', ?, ?, ?, ?, 'image/jpeg', ?, ?, ?, ?, ?, ?, 'account-a',
             ?, ?, ?, 0, ?)`,
  ).run(
    input.id,
    `photos/${input.id}/original.jpg`,
    `https://original.example/${input.id}.jpg`,
    `https://review.example/${input.id}.jpg`,
    `https://public.example/${input.id}.jpg`,
    `caption-${input.id}`,
    input.status ?? 'adopted',
    input.awardedPoints ?? 0,
    NOW,
    input.status === 'pending' ? null : NOW,
    NOW,
    consentAt ? 'photo-public-v1' : null,
    consentAt,
    input.consentWithdrawnAt ?? null,
    input.reviewedByName ?? '審査した担当',
  );
}

function insertPublication(
  testDb: SqliteD1,
  input: {
    id: string;
    photoId: string;
    status?: 'published' | 'withdrawn';
    withdrawnAt?: string | null;
    withdrawnBy?: string | null;
    updatedAt?: string;
  },
): void {
  const status = input.status ?? 'published';
  testDb.raw.prepare(
    `INSERT INTO nen_photo_publications
      (id, photo_id, line_account_id, status, show_owner_name, version,
       published_at, withdrawn_at, withdrawn_by, updated_at)
     VALUES (?, ?, 'account-a', ?, 0, 1, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.photoId,
    status,
    NOW,
    input.withdrawnAt === undefined ? (status === 'withdrawn' ? NOW : null) : input.withdrawnAt,
    input.withdrawnBy ?? null,
    input.updatedAt ?? NOW,
  );
}

function insertPlacement(
  testDb: SqliteD1,
  input: {
    id: string;
    publicationId: string;
    active?: number;
    removedAt?: string | null;
  },
): void {
  const active = input.active ?? 1;
  testDb.raw.prepare(
    `INSERT INTO nen_photo_publication_placements
      (id, publication_id, line_account_id, placement_type, placement_label,
       view_count, active, created_at, removed_at)
     VALUES (?, ?, 'account-a', 'site', ?, NULL, ?, ?, ?)`,
  ).run(
    input.id,
    input.publicationId,
    `placement-${input.id}`,
    active,
    NOW,
    input.removedAt === undefined ? (active === 1 ? null : NOW) : input.removedAt,
  );
}

type TestEnv = {
  Bindings: { DB: D1Database };
  Variables: { staff: { id: string; name: string; role: string; readOnly: boolean } };
};

function app(db: D1Database) {
  const target = new Hono<TestEnv>();
  target.use('*', async (c, next) => {
    // owner は閲覧・操作どちらの権限確認も通る。
    c.set('staff', { id: 'env-owner', name: '管理者', role: 'owner', readOnly: false });
    c.env = { DB: db };
    await next();
  });
  target.route('/', nenMembers);
  return target;
}

describe('写真審査の掲載管理（実DB / Issue #1040 IDEA-22）', () => {
  let testDb: SqliteD1;
  let target: ReturnType<typeof app>;

  beforeEach(() => {
    testDb = createTestD1();
    insertAccount(testDb, 'account-a');
    insertFriend(testDb.raw, 'friend-a', { line_account_id: 'account-a' });
    insertPet(testDb, 'pet-a', 'friend-a');
    testDb.raw.prepare(
      `INSERT INTO staff_members (id, name, role, api_key) VALUES ('staff-1', '外した担当', 'admin', 'key-1')`,
    ).run();
    target = app(testDb.db);
  });

  afterEach(() => testDb.raw.close());

  it('公開中・同意撤回で整理待ち・外し済みを分けて返し、撤回後に残る掲載先を追える', async () => {
    insertPhoto(testDb, { id: 'photo-live', awardedPoints: 5 });
    insertPublication(testDb, { id: 'pub-live', photoId: 'photo-live' });
    insertPlacement(testDb, { id: 'pl-live', publicationId: 'pub-live' });
    testDb.raw.prepare(
      `INSERT INTO nen_photo_reward_outbox
        (id, photo_id, line_account_id, friend_id, customer_id, provider_award_key,
         policy_version, points, status, created_at, updated_at)
       VALUES ('out-1', 'photo-live', 'account-a', 'friend-a', 'cust-1', 'nen-photo:photo-live',
               'legacy-5', 5, 'synced', ?, ?)`,
    ).run(NOW, NOW);

    // 本人がLIFFで同意を撤回したが、掲載先の登録は残っている
    insertPhoto(testDb, { id: 'photo-revoked', awardedPoints: 5, consentWithdrawnAt: NOW });
    insertPublication(testDb, { id: 'pub-revoked', photoId: 'photo-revoked' });
    insertPlacement(testDb, { id: 'pl-revoked', publicationId: 'pub-revoked' });

    // 掲載先から外し終えた履歴
    insertPhoto(testDb, { id: 'photo-gone', awardedPoints: 5 });
    insertPublication(testDb, {
      id: 'pub-gone', photoId: 'photo-gone', status: 'withdrawn', withdrawnBy: 'staff-1',
    });
    insertPlacement(testDb, { id: 'pl-gone', publicationId: 'pub-gone', active: 0 });

    const response = await target.request('/api/nen-members/photos/publications?accountId=account-a');
    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: {
        summary: Record<string, number>;
        items: Array<Record<string, unknown>>;
        pendingWithdrawals: Array<Record<string, unknown>>;
        withdrawnItems: Array<Record<string, unknown>>;
      };
    };
    expect(body.data.summary).toMatchObject({
      publishedCount: 1, attentionCount: 1, withdrawnCount: 1,
    });

    // 公開中のものは同意・採用・ポイントの実状態つき
    expect(body.data.items.map((row) => row.photo_id)).toEqual(['photo-live']);
    const live = body.data.items[0];
    expect(live.publication_consent_version).toBe('photo-public-v1');
    expect(live.point_sync_status).toBe('synced');
    expect(live.awarded_points).toBe(5);
    expect(live.placements).toEqual([
      expect.objectContaining({ id: 'pl-live', active: 1, removed_at: null }),
    ]);

    // 撤回後に残る公開先: 掲載先が active=1 のまま追える
    expect(body.data.pendingWithdrawals.map((row) => row.photo_id)).toEqual(['photo-revoked']);
    const revoked = body.data.pendingWithdrawals[0];
    expect(revoked.publication_withdrawn_at).toBe(NOW);
    expect(revoked.placements).toEqual([
      expect.objectContaining({ id: 'pl-revoked', active: 1 }),
    ]);

    // 外し済みは担当と外した日時・元の掲載先が残る
    expect(body.data.withdrawnItems.map((row) => row.photo_id)).toEqual(['photo-gone']);
    const gone = body.data.withdrawnItems[0];
    expect(gone.status).toBe('withdrawn');
    expect(gone.withdrawn_by_name).toBe('外した担当');
    expect(gone.placements).toEqual([
      expect.objectContaining({ id: 'pl-gone', active: 0, removed_at: NOW }),
    ]);
  });

  it('詳細は採用履歴・報酬の実状態・公開先を一緒に返す', async () => {
    insertPhoto(testDb, { id: 'photo-live', awardedPoints: 5 });
    testDb.raw.prepare(
      `INSERT INTO nen_photo_review_events
        (id, photo_id, line_account_id, from_status, to_status, awarded_points,
         reviewed_by, reviewed_by_name, notification_status, created_at, updated_at)
       VALUES ('ev-1', 'photo-live', 'account-a', 'pending', 'adopted', 5,
               'staff-1', '審査した担当', 'sent', ?, ?)`,
    ).run(NOW, NOW);
    testDb.raw.prepare(
      `INSERT INTO nen_photo_reward_outbox
        (id, photo_id, line_account_id, friend_id, customer_id, provider_award_key,
         policy_version, points, status, synced_at, created_at, updated_at)
       VALUES ('out-1', 'photo-live', 'account-a', 'friend-a', 'cust-1', 'nen-photo:photo-live',
               'legacy-5', 5, 'synced', ?, ?, ?)`,
    ).run(NOW, NOW, NOW);
    insertPublication(testDb, { id: 'pub-live', photoId: 'photo-live' });
    insertPlacement(testDb, { id: 'pl-live', publicationId: 'pub-live' });

    const response = await target.request('/api/nen-members/photos/photo-live?accountId=account-a');
    expect(response.status).toBe(200);
    const body = await response.json() as { data: Record<string, unknown> };
    expect(body.data.history).toEqual([
      expect.objectContaining({
        to_status: 'adopted', awarded_points: 5, reviewed_by_name: '審査した担当',
        notification_status: 'sent',
      }),
    ]);
    expect(body.data.reward).toMatchObject({ status: 'synced', points: 5 });
    expect(body.data.publication).toMatchObject({ id: 'pub-live', status: 'published' });
    expect((body.data.publication as { placements: unknown[] }).placements).toEqual([
      expect.objectContaining({ id: 'pl-live', active: 1 }),
    ]);
  });

  it('未審査の写真は履歴なし・報酬なし・公開先なしで返す', async () => {
    insertPhoto(testDb, { id: 'photo-new', status: 'pending', consentAt: null });
    const response = await target.request('/api/nen-members/photos/photo-new?accountId=account-a');
    expect(response.status).toBe(200);
    const body = await response.json() as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({ history: [], reward: null, publication: null });
  });

  it('採用1回に対し付与の手続きは1回だけ（写真ごとに一意）', () => {
    insertPhoto(testDb, { id: 'photo-live', awardedPoints: 5 });
    const insert = () => testDb.raw.prepare(
      `INSERT INTO nen_photo_reward_outbox
        (id, photo_id, line_account_id, friend_id, customer_id, provider_award_key,
         policy_version, points, status, created_at, updated_at)
       VALUES (?, 'photo-live', 'account-a', 'friend-a', 'cust-1', ?, 'legacy-5', 5,
               'pending', ?, ?)`,
    );
    insert().run('out-1', 'nen-photo:photo-live', NOW, NOW);
    // 同じ写真への2回目の付与手続きは一意制約で弾かれる
    expect(() => insert().run('out-2', 'nen-photo:photo-live:2', NOW, NOW)).toThrow(/UNIQUE/);
  });
});
