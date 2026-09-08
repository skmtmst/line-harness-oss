import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  canAccess: vi.fn(),
  push: vi.fn(),
  syncTags: vi.fn(),
  resolveCredential: vi.fn(),
  jstNow: vi.fn(() => '2026-08-28 03:00:00'),
}));

vi.mock('@line-crm/db', () => ({
  getFriendByLineUserIdForAccount: vi.fn(),
  jstNow: mocks.jstNow,
  resolveLineCredential: mocks.resolveCredential,
}));
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: mocks.canAccess,
  getVisibleLineAccountScope: vi.fn(),
}));
vi.mock('../services/line-proxy-send.js', () => ({ pushViaHarnessProxy: mocks.push }));
vi.mock('../services/local-line-proxy.js', () => ({ dispatchLineProxyLocally: vi.fn() }));
vi.mock('../services/nen-tag-sync.js', () => ({
  refreshAllNenTags: vi.fn(), syncNenHealthTags: vi.fn(),
  syncNenPetTags: vi.fn(), syncNenPhotoTags: mocks.syncTags,
}));

const { nenMembers, loadPhotoReviewRecipient } = await import('./nen-members.js');

type Entry = { query: string; bindings: unknown[] };

function harness(options: {
  photoAccount?: string;
  duplicate?: boolean;
  customerId?: string | null;
  permissionKeys?: string[];
} = {}) {
  const statements: Entry[] = [];
  const batches: Entry[][] = [];
  const photoAccount = options.photoAccount ?? 'account-a';
  const db = {
    prepare(query: string) {
      const entry: Entry = { query, bindings: [] };
      statements.push(entry);
      const statement = {
        query,
        get bindings() { return entry.bindings; },
        bind(...bindings: unknown[]) { entry.bindings = bindings; return statement; },
        async first() {
          if (query.includes('LEFT JOIN line_accounts la') && query.includes('WHERE f.id = ?')) {
            return {
              id: 'friend-1', line_user_id: 'U1', display_name: '利用者', is_following: 1,
              line_account_id: photoAccount, line_account_name: '店舗A',
            };
          }
          if (query.includes('ps.review_image_url AS image_url') && query.includes('submission_count')) {
            if (entry.bindings[1] !== photoAccount || entry.bindings[2] !== photoAccount) return null;
            return { id: 'photo-1', image_url: 'https://example.test/review.jpg', review_version: 1 };
          }
          if (query.includes('FROM nen_photo_publications WHERE id')) {
            return {
              id: 'publication-1', photo_id: 'photo-1', status: 'published', version: 2,
              last_idempotency_key: null,
            };
          }
          if (query.includes('JOIN nen_photo_review_events')) {
            if (entry.bindings[1] !== photoAccount || entry.bindings[2] !== photoAccount) return null;
            return {
              id: 'photo-1', friend_id: 'friend-1', line_user_id: 'U1', line_account_id: photoAccount,
              is_following: 1, channel_access_token: 'token', channel_access_token_encrypted: null,
              decision_id: 'decision-1', to_status: 'rejected', reason_code: 'privacy',
              reason_note: '顔が写っていない写真をお願いします。',
            };
          }
          if (query.includes('FROM nen_photo_submissions ps') && query.includes('JOIN line_accounts')) {
            if (entry.bindings[1] !== photoAccount || entry.bindings[2] !== photoAccount) return null;
            return {
              id: 'photo-1', friend_id: 'friend-1', status: 'pending', review_version: 1,
              customer_id: options.customerId ?? null,
              line_user_id: 'U1', line_account_id: photoAccount, is_following: 1,
              channel_access_token: 'token', channel_access_token_encrypted: null,
            };
          }
          return null;
        },
        async all() {
          if (query.includes('FROM nen_photo_publications pub')) {
            return { results: [{ id: 'publication-1', photo_id: 'photo-1', view_count: null, version: 2 }] };
          }
          if (query.includes('FROM nen_photo_publication_placements')) {
            // 一覧は掲載先をINで1発取得する。振り分け鍵の publication_id を返す。
            return { results: [{ publication_id: 'publication-1', id: 'placement-1', placement_type: 'column', placement_label: 'コラム', view_count: null }] };
          }
          if (query.includes('FROM nen_photo_risk_assessments')) {
            return { results: [{ flag: 'face', confidence: 0.78 }] };
          }
          if (query.includes('ORDER BY ps.created_at')) return { results: [{ id: 'photo-1' }] };
          return { results: [] };
        },
        async run() { return { success: true, meta: { changes: 1 } }; },
      };
      return statement;
    },
    async batch(items: Array<{ query: string; bindings: unknown[] }>) {
      if (options.duplicate && items.some((item) => item.query.includes('INSERT INTO nen_photo_review_events'))) {
        throw new Error('UNIQUE constraint failed');
      }
      const entries = items.map((item) => ({ query: item.query, bindings: [...item.bindings] }));
      batches.push(entries);
      return entries.map(() => ({ success: true, meta: { changes: 1 } }));
    },
  };
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('staff', {
      id: 'staff-a', name: '担当者', role: 'staff', readOnly: false,
      permissionKeys: options.permissionKeys
        ?? ['photo.submission.view', 'photo.submission.review'],
    });
    c.env = { DB: db, WORKER_PUBLIC_URL: 'https://worker.example' };
    await next();
  });
  app.route('/', nenMembers);
  return { app, statements, batches };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canAccess.mockResolvedValue(true);
  mocks.resolveCredential.mockResolvedValue('resolved-token');
  mocks.push.mockResolvedValue(undefined);
  mocks.syncTags.mockResolvedValue(undefined);
});

describe('NEN photo review', () => {
  it('requires an explicit LINE account and lists only that account', async () => {
    const { app, statements } = harness();
    expect((await app.request('/api/nen-members/photos')).status).toBe(400);
    expect((await app.request('/api/nen-members/photos?accountId=account-a')).status).toBe(200);
    const list = statements.find((entry) => entry.query.includes('ORDER BY ps.created_at'));
    expect(list?.query).toContain('ps.line_account_id = ? AND f.line_account_id = ?');
    expect(list?.bindings).toEqual(['account-a', 'account-a']);
  });

  it('returns a review derivative and risks without an original object key', async () => {
    const { app } = harness();
    const response = await app.request('/api/nen-members/photos/photo-1?accountId=account-a');
    expect(response.status).toBe(200);
    const body = await response.json() as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      id: 'photo-1', image_url: 'https://example.test/review.jpg',
      risks: [{ flag: 'face', confidence: 0.78 }],
    });
    expect(body.data).not.toHaveProperty('r2_key');
  });

  it('lists only consented active publications and preserves unknown view counts', async () => {
    const { app, statements } = harness();
    const response = await app.request('/api/nen-members/photos/publications?accountId=account-a');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { summary: { publishedCount: 1, placementCount: 1 }, items: [{ view_count: null }] },
    });
    const list = statements.find((entry) => entry.query.includes('FROM nen_photo_publications pub'));
    expect(list?.query).toContain("pub.line_account_id = ? AND pub.status = 'published'");
    expect(list?.query).toContain('ps.publication_consent_at IS NOT NULL');
  });

  it('requires photo view permission before listing publications', async () => {
    const { app, statements } = harness({ permissionKeys: [] });
    const response = await app.request('/api/nen-members/photos/publications?accountId=account-a');

    expect(response.status).toBe(403);
    expect(statements.some((entry) => entry.query.includes('FROM nen_photo_publications pub'))).toBe(false);
  });

  it('friend overview never selects the private original object key', async () => {
    const { app, statements } = harness();
    const response = await app.request('/api/nen-members/friends/friend-1');

    expect(response.status).toBe(200);
    const photoQuery = statements.find((entry) => entry.query.includes('FROM nen_photo_submissions ps')
      && entry.query.includes('WHERE ps.friend_id = ?'));
    expect(photoQuery?.query).not.toContain('ps.*');
    expect(photoQuery?.query).not.toContain('r2_key');
    expect(photoQuery?.query).not.toMatch(/\bps\.image_url\b/);
  });

  it('returns permission denied before reading photo workspace data', async () => {
    mocks.canAccess.mockResolvedValueOnce(false);
    const { app, statements } = harness();
    const response = await app.request('/api/nen-members/photos/photo-1?accountId=account-a');
    expect(response.status).toBe(403);
    expect(statements.some((entry) => entry.query.includes('submission_count'))).toBe(false);
  });

  it('withdraws every placement with account scope, version and idempotency', async () => {
    const { app, batches } = harness();
    const response = await app.request('/api/nen-members/photos/publications/publication-1/withdraw', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'withdraw-once' },
      body: JSON.stringify({ accountId: 'account-a', expectedVersion: 2 }),
    });
    expect(response.status).toBe(200);
    expect(batches[0][0].query).toContain("status = 'published' AND version = ?");
    expect(batches[0][1].query).toContain('line_account_id = ? AND active = 1');
    expect(batches[0][2].query).toContain('publication_withdrawn_at');
  });

  it('replaces publication placements with account scope, version and idempotency', async () => {
    const { app, batches } = harness();
    const response = await app.request('/api/nen-members/photos/publications/publication-1/placements', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'placements-once' },
      body: JSON.stringify({
        accountId: 'account-a', expectedVersion: 2,
        placements: [{ type: 'rich_menu', label: 'リッチメニュー' }, { type: 'site', label: 'サイト' }],
      }),
    });
    expect(response.status).toBe(200);
    expect(batches[0][0].query).toContain("status = 'published' AND version = ?");
    expect(batches[0][1].query).toContain('active = 0');
    expect(batches[0].filter((entry) => entry.query.includes('INSERT INTO nen_photo_publication_placements'))).toHaveLength(2);
  });

  it('requires a user-facing rejection reason', async () => {
    const { app, batches } = harness();
    const response = await app.request('/api/nen-members/photos/photo-1/review', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 'account-a', status: 'rejected', expectedVersion: 1 }),
    });
    expect(response.status).toBe(400);
    expect(batches).toHaveLength(0);
  });

  it('stores the decision and sends the same reason to the submitter', async () => {
    const { app, batches } = harness();
    const response = await app.request('/api/nen-members/photos/photo-1/review', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        accountId: 'account-a', status: 'rejected', expectedVersion: 1, reasonCode: 'privacy',
        reasonNote: '顔が写っていない写真をお願いします。',
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { notificationStatus: 'sent' } });
    const decision = batches[0].find((entry) => entry.query.includes('INSERT INTO nen_photo_review_events'));
    expect(decision?.bindings).toEqual([
      expect.any(String), 'photo-1', 'account-a', 'rejected', 'privacy',
      '顔が写っていない写真をお願いします。', 0, 'staff-a', '担当者',
      '2026-08-28 03:00:00', '2026-08-28 03:00:00', 'photo-1', 'account-a', 1,
    ]);
    expect(mocks.push).toHaveBeenCalledWith(
      'https://worker.example', 'resolved-token', 'U1',
      [{ type: 'text', text: expect.stringContaining('人の顔や個人情報が写っている') }],
      expect.stringMatching(/^nen-photo-review:/), expect.any(Function),
    );
  });

  it('loads the notification recipient only inside the same LINE account', async () => {
    const seen: Array<{ query: string; bindings: unknown[] }> = [];
    const stubDb = {
      prepare(query: string) {
        const entry = { query, bindings: [] as unknown[] };
        seen.push(entry);
        return {
          bind(...bindings: unknown[]) { entry.bindings = bindings; return this; },
          async first() { return { id: 'photo-1', friend_id: 'friend-1' }; },
        };
      },
    };
    const row = await loadPhotoReviewRecipient(stubDb as unknown as D1Database, {
      photoId: 'photo-1', lineAccountId: 'account-a',
    });
    expect(row).toMatchObject({ id: 'photo-1' });
    expect(seen).toHaveLength(1);
    // 写真・LINEアカウント・友だちの所属の3点を同じ値で絞る。
    expect(seen[0].query).toContain('ps.id = ? AND ps.line_account_id = ? AND f.line_account_id = ?');
    expect(seen[0].bindings).toEqual(['photo-1', 'account-a', 'account-a']);
    expect(seen[0].query).not.toContain('r2_key');
  });

  it('does not review a photo owned by another account', async () => {
    const { app, batches } = harness({ photoAccount: 'account-b' });
    const response = await app.request('/api/nen-members/photos/photo-1/review', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 'account-a', status: 'rejected', expectedVersion: 1, reasonCode: 'quality' }),
    });
    expect(response.status).toBe(404);
    expect(batches).toHaveLength(0);
  });

  it('rejects inherited object property names as reason codes', async () => {
    const { app, batches } = harness();
    const response = await app.request('/api/nen-members/photos/photo-1/review', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 'account-a', status: 'rejected', expectedVersion: 1, reasonCode: 'toString' }),
    });
    expect(response.status).toBe(400);
    expect(batches).toHaveLength(0);
  });

  it('keeps the review saved and records a failed LINE notification', async () => {
    mocks.push.mockRejectedValueOnce(new Error('LINE unavailable'));
    const { app, batches } = harness();
    const response = await app.request('/api/nen-members/photos/photo-1/review', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 'account-a', status: 'rejected', expectedVersion: 1, reasonCode: 'quality' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { notificationStatus: 'failed' } });
    expect(batches[1][0].bindings[0]).toBe('failed');
    expect(batches[1][1].bindings).toEqual([
      'failed', 'LINE unavailable', '2026-08-28 03:00:00', null,
      '2026-08-28 03:00:00', expect.any(String),
    ]);
  });

  it('returns a conflict when another reviewer decided first', async () => {
    const { app } = harness({ duplicate: true });
    const response = await app.request('/api/nen-members/photos/photo-1/review', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 'account-a', status: 'rejected', expectedVersion: 1, reasonCode: 'duplicate' }),
    });
    expect(response.status).toBe(409);
  });

  it('commits approval and a single reward outbox entry before external EC processing', async () => {
    const { app, batches } = harness({ customerId: 'customer-1' });
    const response = await app.request('/api/nen-members/photos/photo-1/review', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 'account-a', status: 'adopted', expectedVersion: 1 }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { awardedPoints: 5, pointBalance: null, pointSync: 'pending' },
    });
    const outbox = batches[0].find((entry) => entry.query.includes('INSERT INTO nen_photo_reward_outbox'));
    expect(outbox?.bindings).toEqual([
      expect.any(String), 'photo-1', 'account-a', 'friend-1', 'customer-1',
      'nen-photo:photo-1', 5,
      '2026-08-28 03:00:00', '2026-08-28 03:00:00', '2026-08-28 03:00:00',
    ]);
  });

  it('retries a failed notification with the recorded decision text', async () => {
    const { app, batches } = harness();
    const response = await app.request('/api/nen-members/photos/photo-1/notification/retry', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 'account-a' }),
    });
    expect(response.status).toBe(200);
    expect(mocks.push).toHaveBeenCalledWith(
      'https://worker.example', 'resolved-token', 'U1',
      [{ type: 'text', text: expect.stringContaining('人の顔や個人情報が写っている') }],
      'nen-photo-review:decision-1', expect.any(Function),
    );
    expect(batches[0][0].query).toContain("review_notification_status = 'sent'");
    expect(batches[0][1].query).toContain("notification_status = 'sent'");
    expect(batches[0][1].query).toContain('notification_attempt_count = notification_attempt_count + 1');
    expect(batches[0][1].query).not.toContain('notification_error = NULL');
  });
});
