/*
 * F-20 公式サイト掲載の閲覧数：ECが数えた数を musubo 側で保存して返す受け口。
 *
 * 見る点:
 *  - EC連携の既存の口・署名のまま、新しい種類だけ受け付ける
 *  - 保存して保存後の数を返す（掲載本体＋site掲載先）
 *  - 累計の「大きい方だけ残す」ため、再送や古い数で減らない
 *  - 同じ event_id の再送は受け付け済みとして返し、二重に触らない
 *  - musuboに無い写真IDは無視して知らせる
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../index';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';

vi.mock('../services/event-bus.js', () => ({ fireEvent: vi.fn(), logOutgoingMessage: vi.fn() }));
vi.mock('../services/operator-notification-dispatch.js', () => ({ dispatchOperatorEvent: vi.fn() }));
vi.mock('../services/nen-tag-sync.js', () => ({ syncNenEcTags: vi.fn(), syncNenPetTags: vi.fn() }));
vi.mock('../services/nen-engagement.js', () => ({
  enqueuePostShippingFollowUps: vi.fn(),
  syncNenPetProfiles: vi.fn(),
}));

const { ecIntegrations } = await import('./ec-integrations.js');

let sqlite: SqliteD1['raw'];
let db: D1Database;
const SECRET = 'b'.repeat(32);
const SITE_LABEL = 'https://nen-petfood.com/';

beforeEach(() => {
  vi.clearAllMocks();
  const created = createTestD1();
  sqlite = created.raw;
  db = created.db;
  sqlite.exec(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-a', 'channel-a', 'A店', 'token-a', 'secret-a');
    INSERT INTO friends
      (id, line_user_id, display_name, line_account_id, is_following, created_at, updated_at)
    VALUES ('friend-a', 'U${'c'.repeat(32)}', '山田', 'account-a', 1, '2026-09-01', '2026-09-01');
    INSERT INTO nen_pet_profiles
      (id, friend_id, name, created_at, updated_at)
    VALUES ('pet-a', 'friend-a', 'ポチ', '2026-09-01', '2026-09-01');
    INSERT INTO nen_photo_submissions
      (id, friend_id, pet_id, line_account_id, r2_key, image_url, content_type,
       status, created_at, updated_at)
    VALUES ('photo-a', 'friend-a', 'pet-a', 'account-a', 'r2-a',
      'https://example.com/a.jpg', 'image/jpeg', 'adopted', '2026-09-01', '2026-09-01');
    INSERT INTO nen_photo_publications
      (id, photo_id, line_account_id, status, published_at, updated_at)
    VALUES ('pub-a', 'photo-a', 'account-a', 'published', '2026-09-02', '2026-09-02');
    INSERT INTO nen_photo_publication_placements
      (id, publication_id, line_account_id, placement_type, placement_label,
       active, created_at, removed_at)
    VALUES ('pl-a', 'pub-a', 'account-a', 'site', '${SITE_LABEL}', 1, '2026-09-02', NULL);
  `);
});

const app = new Hono<Env>();
app.route('/', ecIntegrations);

async function signature(timestamp: string, accountId: string, body: string) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(`${timestamp}.${accountId}.${body}`),
  ));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const baseEvent = (overrides: Record<string, unknown> = {}) => ({
  event_id: 'evt-view-1001',
  event_type: 'ec.site.publication_viewed',
  occurred_at: '2026-10-03T12:00:00+09:00',
  publication_views: [
    { photo_id: 'photo-a', view_count: 123, placement_label: SITE_LABEL },
  ],
  ...overrides,
});

async function post(event: Record<string, unknown>, accountId = 'account-a') {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify(event);
  return app.request('/api/integrations/eccube/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-line-account-id': accountId,
      'x-nen-timestamp': timestamp,
      'x-nen-signature': `sha256=${await signature(timestamp, accountId, body)}`,
    },
    body,
  }, { DB: db, ECCUBE_WEBHOOK_SECRET: SECRET });
}

const publicationViews = () => sqlite.prepare(
  `SELECT p.view_count AS pub_views, pl.view_count AS placement_views
     FROM nen_photo_publications p
     JOIN nen_photo_publication_placements pl ON pl.publication_id = p.id
    WHERE p.photo_id = 'photo-a'`,
).get() as { pub_views: number | null; placement_views: number | null };

describe('掲載閲覧数の受け口（F-20）', () => {
  it('保存して保存後の数を返す', async () => {
    const response = await post(baseEvent());
    expect(response.status).toBe(200);
    const json = await response.json() as Record<string, unknown>;
    expect(json).toMatchObject({ success: true, status: 'view_counts_saved' });
    expect(json.saved).toEqual([
      { photo_id: 'photo-a', view_count: 123, placement_label: SITE_LABEL },
    ]);
    expect(publicationViews()).toEqual({ pub_views: 123, placement_views: 123 });
  });

  it('古い数では減らず、新しい数では増える', async () => {
    await post(baseEvent());
    const lower = await post(baseEvent({
      event_id: 'evt-view-1002',
      publication_views: [{ photo_id: 'photo-a', view_count: 50 }],
    }));
    expect(lower.status).toBe(200);
    expect(publicationViews().pub_views).toBe(123);
    const higher = await post(baseEvent({
      event_id: 'evt-view-1003',
      publication_views: [{ photo_id: 'photo-a', view_count: 200 }],
    }));
    expect(higher.status).toBe(200);
    expect(publicationViews()).toEqual({ pub_views: 200, placement_views: 123 });
  });

  it('同じ event_id の再送は受け付け済みとして返す', async () => {
    await post(baseEvent());
    const resend = await post(baseEvent());
    const json = await resend.json() as Record<string, unknown>;
    expect(json).toMatchObject({ success: true, duplicate: true });
    expect(publicationViews().pub_views).toBe(123);
  });

  it('musuboに無い写真は無視して知らせる', async () => {
    const response = await post(baseEvent({
      event_id: 'evt-view-1004',
      publication_views: [{ photo_id: 'photo-missing', view_count: 10 }],
    }));
    expect(response.status).toBe(200);
    const json = await response.json() as Record<string, unknown>;
    expect(json).toMatchObject({ success: true, status: 'view_counts_saved', unknownPhotos: ['photo-missing'] });
    expect(publicationViews().pub_views).toBeNull();
  });

  it('形がおかしい数は受け付けない', async () => {
    for (const bad of [
      baseEvent({ event_id: 'evt-view-1005', publication_views: [] }),
      baseEvent({ event_id: 'evt-view-1006', publication_views: [{ photo_id: 'photo-a', view_count: -1 }] }),
      baseEvent({ event_id: 'evt-view-1007', publication_views: [{ photo_id: '', view_count: 5 }] }),
    ]) {
      const response = await post(bad);
      expect(response.status).toBe(400);
    }
    expect(publicationViews().pub_views).toBeNull();
  });
});

 it('keeps dated counts separate, deduplicates daily snapshots, and retries a failed receipt', async () => {
  const day=new Date().toISOString().slice(0,10);
  const event=baseEvent({event_id:'daily-event-a',publication_views:[{photo_id:'photo-a',view_count:20,view_date:day}]});
  expect((await post(event)).status).toBe(200);
  expect((await post(event)).status).toBe(200);
  expect(publicationViews().pub_views).toBeNull();
  expect(sqlite.prepare('SELECT sum(view_count) AS n FROM nen_photo_publication_daily_views').get()).toEqual({n:20});
  // A failed receipt must be retryable with the same stable event ID.
  sqlite.prepare("UPDATE ec_events SET status='failed' WHERE external_event_id='daily-event-a'").run();
  expect(await (await post(event)).json()).toMatchObject({success:true,status:'view_counts_saved'});
  expect(sqlite.prepare('SELECT sum(view_count) AS n FROM nen_photo_publication_daily_views').get()).toEqual({n:20});
  for(const view_date of ['2026-02-30','invalid','2999-01-01']) expect((await post(baseEvent({event_id:view_date,publication_views:[{photo_id:'photo-a',view_count:1,view_date}]}))).status).toBe(400);
 });
