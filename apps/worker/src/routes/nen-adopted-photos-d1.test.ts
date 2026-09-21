import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { nenMembers } from './nen-members.js';

const NOW = '2026-09-21T00:00:00.000Z';

function insertAccount(
  testDb: SqliteD1,
  input: { id: string; basicId: string; active?: number; archivedAt?: string | null },
): void {
  testDb.raw.prepare(
    `INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, is_active, archived_at, line_basic_id)
     VALUES (?, ?, ?, 'token', 'secret', ?, ?, ?)`,
  ).run(
    input.id,
    `channel-${input.id}`,
    input.id,
    input.active ?? 1,
    input.archivedAt ?? null,
    input.basicId,
  );
}

function insertPet(testDb: SqliteD1, id: string, friendId: string): void {
  testDb.raw.prepare(
    `INSERT INTO nen_pet_profiles
      (id, friend_id, name, animal_type, created_at, updated_at)
     VALUES (?, ?, ?, 'dog', ?, ?)`,
  ).run(id, friendId, `${id} name`, NOW, NOW);
}

type PhotoFixture = {
  id: string;
  photoAccountId?: string;
  friendId?: string;
  petId?: string;
  status?: 'pending' | 'adopted' | 'rejected';
  consentAt?: string | null;
  consentWithdrawnAt?: string | null;
  publicImageUrl?: string | null;
  publicationAccountId?: string;
  publicationStatus?: 'published' | 'withdrawn';
  publicationWithdrawnAt?: string | null;
  placementAccountId?: string;
  placementType?: 'rich_menu' | 'column' | 'form' | 'site';
  placementActive?: number;
  placementRemovedAt?: string | null;
};

function insertPhoto(testDb: SqliteD1, input: PhotoFixture): void {
  const photoAccountId = input.photoAccountId ?? 'account-a';
  const publicationAccountId = input.publicationAccountId ?? photoAccountId;
  const placementAccountId = input.placementAccountId ?? publicationAccountId;
  const consentAt = input.consentAt === undefined ? NOW : input.consentAt;
  const publicImageUrl = input.publicImageUrl === undefined
    ? `https://public.example/${input.id}.jpg`
    : input.publicImageUrl;
  const publicationStatus = input.publicationStatus ?? 'published';
  const publicationWithdrawnAt = input.publicationWithdrawnAt === undefined
    ? (publicationStatus === 'withdrawn' ? NOW : null)
    : input.publicationWithdrawnAt;
  const placementActive = input.placementActive ?? 1;
  const placementRemovedAt = input.placementRemovedAt === undefined
    ? (placementActive === 1 ? null : NOW)
    : input.placementRemovedAt;

  testDb.raw.prepare(
    `INSERT INTO nen_photo_submissions
      (id, friend_id, pet_id, r2_key, image_url, review_image_url, public_image_url,
       content_type, caption, status, created_at, reviewed_at, updated_at, line_account_id,
       publication_consent_version, publication_consent_at, publication_withdrawn_at, public_pet_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'image/jpeg', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  ).run(
    input.id,
    input.friendId ?? 'friend-a',
    input.petId ?? 'pet-a',
    `photos/${input.id}/original.jpg`,
    `https://original.example/${input.id}.jpg`,
    `https://review.example/${input.id}.jpg`,
    publicImageUrl,
    `caption-${input.id}`,
    input.status ?? 'adopted',
    NOW,
    NOW,
    NOW,
    photoAccountId,
    consentAt ? 'photo-public-v1' : null,
    consentAt,
    input.consentWithdrawnAt ?? null,
  );

  testDb.raw.prepare(
    `INSERT INTO nen_photo_publications
      (id, photo_id, line_account_id, status, show_owner_name, version,
       published_at, withdrawn_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 1, ?, ?, ?)`,
  ).run(
    `publication-${input.id}`,
    input.id,
    publicationAccountId,
    publicationStatus,
    NOW,
    publicationWithdrawnAt,
    NOW,
  );

  testDb.raw.prepare(
    `INSERT INTO nen_photo_publication_placements
      (id, publication_id, line_account_id, placement_type, placement_label,
       active, created_at, removed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `placement-${input.id}`,
    `publication-${input.id}`,
    placementAccountId,
    input.placementType ?? 'site',
    `placement-${input.id}`,
    placementActive,
    NOW,
    placementRemovedAt,
  );
}

function app(db: D1Database) {
  const target = new Hono<any>();
  target.use('*', async (c, next) => {
    c.env = { DB: db };
    await next();
  });
  target.route('/', nenMembers);
  return target;
}

describe('GET /api/public/nen/adopted-photos', () => {
  let testDb: SqliteD1;
  let target: ReturnType<typeof app>;

  beforeEach(() => {
    testDb = createTestD1();
    insertAccount(testDb, { id: 'account-a', basicId: '@nen' });
    insertAccount(testDb, { id: 'account-b', basicId: '@other' });
    insertAccount(testDb, { id: 'account-inactive', basicId: '@inactive', active: 0 });
    insertAccount(testDb, { id: 'account-archived', basicId: '@archived', archivedAt: NOW });
    insertAccount(testDb, { id: 'account-duplicate-a', basicId: '@duplicate' });
    insertAccount(testDb, { id: 'account-duplicate-b', basicId: '@duplicate' });
    insertFriend(testDb.raw, 'friend-a', { line_account_id: 'account-a' });
    insertFriend(testDb.raw, 'friend-b', { line_account_id: 'account-b' });
    insertPet(testDb, 'pet-a', 'friend-a');
    insertPet(testDb, 'pet-b', 'friend-b');
    target = app(testDb.db);
  });

  afterEach(() => testDb.raw.close());

  it('resolves a trimmed official account Basic ID and returns only its active site publication', async () => {
    insertPhoto(testDb, { id: 'valid-a' });
    insertPhoto(testDb, {
      id: 'valid-b', photoAccountId: 'account-b', friendId: 'friend-b', petId: 'pet-b',
    });

    const response = await target.request(
      '/api/public/nen/adopted-photos?officialAccountBasicId=%20%40nen%20',
      { headers: { Origin: 'https://stg.nen-petfood.com' } },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: [{
        id: 'valid-a', imageUrl: 'https://public.example/valid-a.jpg',
        caption: 'caption-valid-a', petName: null,
      }],
    });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://stg.nen-petfood.com');
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('keeps the existing internal lineAccountId selector compatible', async () => {
    insertPhoto(testDb, { id: 'valid-a' });
    const response = await target.request('/api/public/nen/adopted-photos?lineAccountId=account-a');
    expect(response.status).toBe(200);
    expect((await response.json() as { data: Array<{ id: string }> }).data.map((row) => row.id))
      .toEqual(['valid-a']);
  });

  it('accepts both selectors only when they identify the same account', async () => {
    insertPhoto(testDb, { id: 'valid-a' });
    const matching = await target.request(
      '/api/public/nen/adopted-photos?lineAccountId=account-a&officialAccountBasicId=%40nen',
    );
    expect(matching.status).toBe(200);

    const mismatch = await target.request(
      '/api/public/nen/adopted-photos?lineAccountId=account-b&officialAccountBasicId=%40nen',
    );
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toEqual({
      success: false, error: 'LINE account selectors do not match',
    });
  });

  it('does not fall back to the sole active account for an unknown Basic ID', async () => {
    testDb.raw.prepare("UPDATE line_accounts SET is_active = 0 WHERE id <> 'account-a'").run();
    insertPhoto(testDb, { id: 'valid-a' });
    const response = await target.request(
      '/api/public/nen/adopted-photos?officialAccountBasicId=%40unknown',
    );
    expect(response.status).toBe(404);
  });

  it.each([
    ['inactive', '@inactive'],
    ['archived', '@archived'],
    ['duplicated', '@duplicate'],
  ])('rejects an %s official account Basic ID', async (_label, basicId) => {
    const response = await target.request(
      `/api/public/nen/adopted-photos?officialAccountBasicId=${encodeURIComponent(basicId)}`,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false, error: 'LINE account not found' });
  });

  it.each([
    ['non-adopted photo', { status: 'pending' as const }],
    ['photo whose consent was withdrawn', { consentWithdrawnAt: NOW }],
    ['photo without explicit consent', { consentAt: null }],
    ['photo without a public derivative', { publicImageUrl: null }],
    ['photo whose friend belongs to another account', { friendId: 'friend-b', petId: 'pet-b' }],
    ['withdrawn publication', { publicationStatus: 'withdrawn' as const }],
    ['inactive site placement', { placementActive: 0 }],
    ['non-site placement', { placementType: 'form' as const }],
    ['site placement from another account', { placementAccountId: 'account-b' }],
  ])('does not expose a %s', async (_label, overrides) => {
    insertPhoto(testDb, { id: 'hidden', ...overrides });
    const response = await target.request(
      '/api/public/nen/adopted-photos?officialAccountBasicId=%40nen',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: [] });
  });
});
