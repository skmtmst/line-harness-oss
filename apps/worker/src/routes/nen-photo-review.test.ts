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

const { nenMembers } = await import('./nen-members.js');

type Entry = { query: string; bindings: unknown[] };

function harness(options: {
  photoAccount?: string;
  duplicate?: boolean;
  detailStatus?: 'pending' | 'adopted' | 'rejected';
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
          if (query.includes('ROW_NUMBER() OVER')) {
            return entry.bindings[0] === photoAccount && entry.bindings[1] === photoAccount
              ? { id: 'photo-1', queue_position: 2, queue_total: 3, previous_id: 'photo-2', next_id: 'photo-0' }
              : null;
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
          if (query.includes('JOIN nen_pet_profiles p') && query.includes('ps.reviewed_by_name')) {
            if (entry.bindings[1] !== photoAccount || entry.bindings[2] !== photoAccount) return null;
            const status = options.detailStatus ?? 'pending';
            return {
              id: 'photo-1', image_url: 'https://example.test/review-photo.jpg', content_type: 'image/jpeg',
              caption: '公園で遊んでいます', status, awarded_points: status === 'adopted' ? 5 : 0,
              created_at: '2026-08-27 12:00:00', reviewed_at: status === 'pending' ? null : '2026-08-28 03:00:00',
              updated_at: status === 'pending' ? '2026-08-27 12:00:00' : '2026-08-28 03:00:00',
              publication_consent_at: '2026-08-27 12:00:00', publication_withdrawn_at: null,
              public_pet_name: 1, review_reason_code: status === 'rejected' ? 'privacy' : null,
              review_reason_note: status === 'rejected' ? '顔が写っていない写真をお願いします。' : null,
              reviewed_by_name: status === 'pending' ? null : '担当者',
              review_notification_status: status === 'pending' ? 'not_required' : 'sent',
              owner_name: '山田 花子', pet_name: 'こむぎ', animal_type: 'dog',
            };
          }
          if (query.includes('FROM nen_photo_submissions ps') && query.includes('JOIN line_accounts')) {
            if (entry.bindings[1] !== photoAccount || entry.bindings[2] !== photoAccount) return null;
            return {
              id: 'photo-1', friend_id: 'friend-1', status: options.detailStatus ?? 'pending',
              updated_at: '2026-08-27 12:00:00', customer_id: null,
              line_user_id: 'U1', line_account_id: photoAccount, is_following: 1,
              channel_access_token: 'token', channel_access_token_encrypted: null,
            };
          }
          return null;
        },
        async all() {
          if (query.includes('FROM nen_photo_review_events') && query.includes('ORDER BY created_at DESC')) {
            return { results: options.detailStatus === 'pending' ? [] : [{
              from_status: 'pending', to_status: options.detailStatus ?? 'rejected', reason_code: 'privacy',
              reason_note: '顔が写っていない写真をお願いします。', awarded_points: 0,
              reviewed_by_name: '担当者', notification_status: 'sent', created_at: '2026-08-28 03:00:00',
              id: 'internal-decision-id', notification_error: 'internal detail',
            }] };
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
    c.set('staff', { id: 'staff-a', name: '担当者', role: 'staff', readOnly: false });
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

  it('requires a user-facing rejection reason', async () => {
    const { app, batches } = harness();
    const response = await app.request('/api/nen-members/photos/photo-1/review', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 'account-a', status: 'rejected' }),
    });
    expect(response.status).toBe(400);
    expect(batches).toHaveLength(0);
  });

  it('returns an account-scoped review detail without private storage or internal event fields', async () => {
    const { app, statements } = harness({ detailStatus: 'rejected' });
    const response = await app.request('/api/nen-members/photos/photo-1?accountId=account-a');
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.data).toMatchObject({
      revision: 'rejected:2026-08-28 03:00:00',
      submitter: { displayName: '山田 花子' },
      pet: { name: 'こむぎ', animalType: 'dog' },
      consent: { publication: 'granted', publicPetName: true },
      review: { decision: 'rejected', reasonLabel: '人の顔や個人情報が写っている' },
      queue: { position: 2, total: 3, previousId: 'photo-2', nextId: 'photo-0' },
      imageSafety: { derivativeAvailable: false, originalDownloadAvailable: false },
      riskAssessment: { state: 'unavailable', items: [] },
      capabilities: { canReview: false, canDownloadOriginal: false, canPublish: false },
    });
    expect(body.data.history[0]).not.toHaveProperty('id');
    expect(body.data.history[0]).not.toHaveProperty('notificationError');
    expect(JSON.stringify(body.data)).not.toContain('r2_key');
    const detail = statements.find((entry) => entry.query.includes('ps.reviewed_by_name'));
    expect(detail?.query).toContain('ps.line_account_id = ? AND f.line_account_id = ?');
    expect(detail?.bindings).toEqual(['photo-1', 'account-a', 'account-a']);
  });

  it('does not return a detail owned by another account', async () => {
    const { app } = harness({ photoAccount: 'account-b' });
    const response = await app.request('/api/nen-members/photos/photo-1?accountId=account-a');
    expect(response.status).toBe(404);
  });

  it('separates a missing account from an account the operator cannot access', async () => {
    const { app } = harness();
    expect((await app.request('/api/nen-members/photos/photo-1')).status).toBe(400);
    mocks.canAccess.mockResolvedValueOnce(false);
    expect((await app.request('/api/nen-members/photos/photo-1?accountId=account-a')).status).toBe(403);
  });

  it('returns unavailable rather than fabricated risk results for a pending photo', async () => {
    const { app } = harness();
    const response = await app.request('/api/nen-members/photos/photo-1?accountId=account-a');
    const body = await response.json() as any;
    expect(body.data.review).toBeNull();
    expect(body.data.riskAssessment).toEqual(expect.objectContaining({ state: 'unavailable', items: [] }));
    expect(body.data.capabilities.canReview).toBe(true);
  });

  it('stops a stale review before points, persistence, or notification', async () => {
    const { app, batches } = harness();
    const response = await app.request('/api/nen-members/photos/photo-1/review', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        accountId: 'account-a', status: 'rejected', reasonCode: 'privacy',
        expectedRevision: 'pending:old-version',
      }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'photo_revision_conflict',
      data: { revision: 'pending:2026-08-27 12:00:00' },
    });
    expect(batches).toHaveLength(0);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('stores the decision and sends the same reason to the submitter', async () => {
    const { app, batches } = harness();
    const response = await app.request('/api/nen-members/photos/photo-1/review', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        accountId: 'account-a', status: 'rejected', reasonCode: 'privacy',
        reasonNote: '顔が写っていない写真をお願いします。',
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { notificationStatus: 'sent' } });
    const decision = batches[0].find((entry) => entry.query.includes('INSERT INTO nen_photo_review_events'));
    expect(decision?.bindings).toEqual([
      expect.any(String), 'photo-1', 'account-a', 'rejected', 'privacy',
      '顔が写っていない写真をお願いします。', 0, 'staff-a', '担当者',
      '2026-08-28 03:00:00', '2026-08-28 03:00:00', 'photo-1', 'account-a',
    ]);
    expect(mocks.push).toHaveBeenCalledWith(
      'https://worker.example', 'resolved-token', 'U1',
      [{ type: 'text', text: expect.stringContaining('人の顔や個人情報が写っている') }],
      expect.stringMatching(/^nen-photo-review:/), expect.any(Function),
    );
  });

  it('does not review a photo owned by another account', async () => {
    const { app, batches } = harness({ photoAccount: 'account-b' });
    const response = await app.request('/api/nen-members/photos/photo-1/review', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 'account-a', status: 'rejected', reasonCode: 'quality' }),
    });
    expect(response.status).toBe(404);
    expect(batches).toHaveLength(0);
  });

  it('rejects inherited object property names as reason codes', async () => {
    const { app, batches } = harness();
    const response = await app.request('/api/nen-members/photos/photo-1/review', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 'account-a', status: 'rejected', reasonCode: 'toString' }),
    });
    expect(response.status).toBe(400);
    expect(batches).toHaveLength(0);
  });

  it('keeps the review saved and records a failed LINE notification', async () => {
    mocks.push.mockRejectedValueOnce(new Error('LINE unavailable'));
    const { app, batches } = harness();
    const response = await app.request('/api/nen-members/photos/photo-1/review', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 'account-a', status: 'rejected', reasonCode: 'quality' }),
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
      body: JSON.stringify({ accountId: 'account-a', status: 'rejected', reasonCode: 'duplicate' }),
    });
    expect(response.status).toBe(409);
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
