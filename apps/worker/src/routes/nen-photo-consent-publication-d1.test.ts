import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const mocks = vi.hoisted(() => ({
  verifyIdentity: vi.fn(),
  getFriend: vi.fn(),
  jstNow: vi.fn(() => '2026-09-24 21:30:00'),
}));

vi.mock('../services/liff-auth.js', () => ({ verifyCallerLineIdentity: mocks.verifyIdentity }));
vi.mock('@line-crm/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@line-crm/db')>(),
  getFriendByLineUserIdForAccount: mocks.getFriend,
  jstNow: mocks.jstNow,
}));

const { nenMembers } = await import('./nen-members.js');
const NOW = '2026-09-24 21:00:00';

function app(db: D1Database) {
  const target = new Hono<any>();
  target.use('*', async (c, next) => {
    c.env = { DB: db, NEN_EC_BASE_URL: 'https://stg.nen-petfood.com' };
    await next();
  });
  target.route('/', nenMembers);
  return target;
}

describe('LIFF 写真掲載同意から公式サイト掲載まで', () => {
  let testDb: SqliteD1;
  let target: ReturnType<typeof app>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyIdentity.mockResolvedValue({ lineUserId: 'U1', lineAccountId: 'account-a' });
    mocks.getFriend.mockResolvedValue({ id: 'friend-a', is_following: 1 });
    testDb = createTestD1();
    testDb.raw.prepare(
      `INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, is_active, line_basic_id)
       VALUES ('account-a', 'channel-a', 'account-a', 'token', 'secret', 1, '@nen')`,
    ).run();
    insertFriend(testDb.raw, 'friend-a', { line_account_id: 'account-a', line_user_id: 'U1' });
    testDb.raw.prepare(
      `INSERT INTO nen_pet_profiles
        (id, friend_id, name, animal_type, created_at, updated_at)
       VALUES ('pet-a', 'friend-a', 'のん', 'dog', ?, ?)`,
    ).run(NOW, NOW);
    testDb.raw.prepare(
      `INSERT INTO nen_photo_submissions
        (id, friend_id, pet_id, r2_key, image_url, review_image_url, public_image_url,
         content_type, caption, status, created_at, reviewed_at, updated_at, line_account_id)
       VALUES ('photo-a', 'friend-a', 'pet-a', 'original.jpg', 'https://review.example/photo-a.jpg',
               'https://review.example/photo-a.jpg', NULL,
               'image/jpeg', 'caption', 'adopted', ?, ?, ?, 'account-a')`,
    ).run(NOW, NOW, NOW);
    target = app(testDb.db);
  });

  afterEach(() => testDb.raw.close());

  it('採用済み写真への同意で掲載台帳とサイト掲載先を冪等に作り、公開APIへ出す', async () => {
    const consent = () => target.request('/api/liff/nen/photos/photo-a/publication-consent', {
      method: 'PUT',
      headers: { Authorization: 'Bearer liff-token', 'content-type': 'application/json' },
      body: JSON.stringify({ consent: true, consentVersion: 'photo-public-v1', showPetName: true }),
    });

    expect((await consent()).status).toBe(200);
    expect((await consent()).status).toBe(200);

    const publication = testDb.raw.prepare(
      `SELECT status, withdrawn_at FROM nen_photo_publications WHERE photo_id = 'photo-a'`,
    ).get() as { status: string; withdrawn_at: string | null };
    expect(publication).toEqual({ status: 'published', withdrawn_at: null });
    expect(testDb.raw.prepare(
      `SELECT public_image_url FROM nen_photo_submissions WHERE id = 'photo-a'`,
    ).get()).toEqual({ public_image_url: 'https://review.example/photo-a.jpg' });
    const placements = testDb.raw.prepare(
      `SELECT placement_type, placement_label, active, removed_at
         FROM nen_photo_publication_placements`,
    ).all();
    expect(placements).toEqual([{
      placement_type: 'site', placement_label: 'https://stg.nen-petfood.com/',
      active: 1, removed_at: null,
    }]);

    const gallery = await target.request('/api/public/nen/adopted-photos?lineAccountId=account-a');
    expect(gallery.status).toBe(200);
    const galleryBody = await gallery.json() as { data: Array<{ petName: string | null }> };
    expect(galleryBody.data).toEqual([expect.objectContaining({ petName: 'のん' })]);
  });

  it('同意を取り消すと公開APIから外し、掲載台帳は監査用に残す', async () => {
    await target.request('/api/liff/nen/photos/photo-a/publication-consent', {
      method: 'PUT',
      headers: { Authorization: 'Bearer liff-token', 'content-type': 'application/json' },
      body: JSON.stringify({ consent: true, consentVersion: 'photo-public-v1', showPetName: false }),
    });
    const withdrawn = await target.request('/api/liff/nen/photos/photo-a/publication-consent', {
      method: 'PUT',
      headers: { Authorization: 'Bearer liff-token', 'content-type': 'application/json' },
      body: JSON.stringify({ consent: false }),
    });
    expect(withdrawn.status).toBe(200);

    const gallery = await target.request('/api/public/nen/adopted-photos?lineAccountId=account-a');
    const galleryBody = await gallery.json() as { data: unknown[] };
    expect(galleryBody.data).toEqual([]);
    expect(testDb.raw.prepare(`SELECT COUNT(*) AS count FROM nen_photo_publications`).get())
      .toEqual({ count: 1 });
  });
});
