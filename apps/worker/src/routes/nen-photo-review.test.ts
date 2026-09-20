import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  canAccess: vi.fn(),
  push: vi.fn(),
  syncTags: vi.fn(),
  resolveCredential: vi.fn(),
  jstNow: vi.fn(() => '2026-08-28 03:00:00'),
  claim: vi.fn(),
  complete: vi.fn(),
  getState: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  getFriendByLineUserIdForAccount: vi.fn(),
  jstNow: mocks.jstNow,
  resolveLineCredential: mocks.resolveCredential,
  claimPhotoNotificationDelivery: mocks.claim,
  completePhotoNotificationDelivery: mocks.complete,
  getPhotoNotificationState: mocks.getState,
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
  viewPermissionKeys?: string[];
  role?: 'owner' | 'admin' | 'staff';
  authenticated?: boolean;
  retryRow?: boolean;
  settledState?: Record<string, unknown> | null;
  notificationRetryKey?: string | null;
  previousDecision?: Record<string, unknown> | null;
  resubmitInvite?: number;
  savedRotation?: number;
  rotationKey?: string | null;
} = {}) {
  const statements: Entry[] = [];
  const batches: Entry[][] = [];
  const runs: Entry[] = [];
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
          if (query.includes('SELECT e.notification_status')) {
            return options.settledState ?? null;
          }
          // 再送口の写真メタ（再実行キー照合。 #931 N-313）。
          if (query.includes('notification_retry_key')) {
            if (entry.bindings[1] !== photoAccount) return null;
            return {
              id: 'photo-1',
              review_notification_status: 'failed',
              notification_retry_key: options.notificationRetryKey ?? null,
            };
          }
          // 単票審査の再実行キー照合（#931 N-313）。同じキーの判断があれば返す。
          if (query.includes('idempotency_key = ?') && query.includes('nen_photo_review_events')) {
            return options.previousDecision ?? null;
          }
          if (query.includes('JOIN nen_photo_review_events')) {
            if (options.retryRow === false) return null;
            if (entry.bindings[1] !== photoAccount || entry.bindings[2] !== photoAccount) return null;
            return {
              id: 'photo-1', friend_id: 'friend-1', line_user_id: 'U1', line_account_id: photoAccount,
              is_following: 1, channel_access_token: 'token', channel_access_token_encrypted: null,
              decision_id: 'decision-1', to_status: 'rejected', reason_code: 'privacy',
              reason_note: '顔が写っていない写真をお願いします。',
              resubmit_invite: options.resubmitInvite ?? 1,
              customer_id: null,
            };
          }
          // 向き保存口の写真（#931 N-309）。
          if (query.includes('display_rotation') && query.includes('rotation_idempotency_key')) {
            if (entry.bindings[1] !== photoAccount) return null;
            return {
              id: 'photo-1', status: 'pending', review_version: 1,
              display_rotation: options.savedRotation ?? 0,
              rotation_idempotency_key: options.rotationKey ?? null,
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
        async run() {
          runs.push({ query, bindings: [...entry.bindings] });
          return { success: true, meta: { changes: 1 } };
        },
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
    if (options.authenticated !== false) {
      c.set('staff', {
        id: 'staff-a', name: '担当者', role: options.role ?? 'staff', readOnly: false,
        permissionKeys: options.permissionKeys
          ?? ['photo.submission.view', 'photo.submission.review'],
        viewPermissionKeys: options.viewPermissionKeys ?? [],
      });
    }
    c.env = { DB: db, WORKER_PUBLIC_URL: 'https://worker.example' };
    await next();
  });
  app.route('/', nenMembers);
  return { app, statements, batches, runs };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canAccess.mockResolvedValue(true);
  mocks.resolveCredential.mockResolvedValue('resolved-token');
  mocks.push.mockResolvedValue(undefined);
  mocks.syncTags.mockResolvedValue(undefined);
  mocks.claim.mockResolvedValue({ generation: 1 });
  mocks.complete.mockResolvedValue(true);
  mocks.getState.mockResolvedValue(null);
});

describe('NEN photo review', () => {
  it('管理者とオーナーは個別キーなしで写真一覧を閲覧できる', async () => {
    for (const role of ['admin', 'owner'] as const) {
      const { app } = harness({ role, permissionKeys: [] });
      expect((await app.request('/api/nen-members/photos?accountId=account-a')).status).toBe(200);
    }
  });

  it('スタッフは編集キーまたは閲覧キーで写真一覧を閲覧できる', async () => {
    const editor = harness({ permissionKeys: ['photo.submission.view'] }).app;
    const viewer = harness({ permissionKeys: [], viewPermissionKeys: ['photo.submission.view'] }).app;
    expect((await editor.request('/api/nen-members/photos?accountId=account-a')).status).toBe(200);
    expect((await viewer.request('/api/nen-members/photos?accountId=account-a')).status).toBe(200);
  });

  it('未認証と権限なしスタッフは写真一覧を閲覧できない', async () => {
    const unauthenticated = harness({ authenticated: false }).app;
    const denied = harness({ permissionKeys: [] }).app;
    expect((await unauthenticated.request('/api/nen-members/photos?accountId=account-a')).status).toBe(403);
    expect((await denied.request('/api/nen-members/photos?accountId=account-a')).status).toBe(403);
  });

  it('管理者でもLINEアカウント範囲外は閲覧できない', async () => {
    mocks.canAccess.mockResolvedValueOnce(false);
    const { app, statements } = harness({ role: 'admin', permissionKeys: [] });
    const response = await app.request('/api/nen-members/photos?accountId=account-b');
    expect(response.status).toBe(403);
    expect(statements.some((entry) => entry.query.includes('ORDER BY ps.created_at'))).toBe(false);
  });

  it('requires an explicit LINE account and lists only that account', async () => {
    const { app, statements } = harness();
    expect((await app.request('/api/nen-members/photos')).status).toBe(400);
    expect((await app.request('/api/nen-members/photos?accountId=account-a')).status).toBe(200);
    const list = statements.find((entry) => entry.query.includes('ORDER BY ps.created_at'));
    expect(list?.query).toContain('ps.line_account_id = ? AND f.line_account_id = ?');
    // 絞り込みの2値のあとは、続きを取るための枚数と開始位置（#666）。
    expect(list?.bindings).toEqual(['account-a', 'account-a', 200, 0]);
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
    // 公開の撤回は審査権限ではなく掲載管理の上位権限が要る（#931 N-311）。
    const { app, batches } = harness({ permissionKeys: ['photo.publication.manage'] });
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
    const { app, batches } = harness({ permissionKeys: ['photo.publication.manage'] });
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
      method: 'PUT', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'reject-no-reason' },
      body: JSON.stringify({ accountId: 'account-a', status: 'rejected', expectedVersion: 1 }),
    });
    expect(response.status).toBe(400);
    expect(batches).toHaveLength(0);
  });

  it('stores the decision and sends the same reason to the submitter', async () => {
    const { app, batches } = harness();
    const response = await app.request('/api/nen-members/photos/photo-1/review', {
      method: 'PUT', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'reject-privacy-1' },
      body: JSON.stringify({
        accountId: 'account-a', status: 'rejected', expectedVersion: 1, reasonCode: 'privacy',
        reasonNote: '顔が写っていない写真をお願いします。',
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { notificationStatus: 'sent' } });
    const decision = batches[0].find((entry) => entry.query.includes('INSERT INTO nen_photo_review_events'));
    // 再実行キーと「再投稿の案内を添えるか」も判断へ残す（#931 N-312/N-313）。
    expect(decision?.bindings).toEqual([
      expect.any(String), 'photo-1', 'account-a', 'rejected', 'privacy',
      '顔が写っていない写真をお願いします。', 0, 'staff-a', '担当者',
      'reject-privacy-1', 1,
      '2026-08-28 03:00:00', '2026-08-28 03:00:00', 'photo-1', 'account-a', 1,
    ]);
    expect(mocks.push).toHaveBeenCalledWith(
      'https://worker.example', 'resolved-token', 'U1',
      [{ type: 'text', text: expect.stringContaining('人の顔や個人情報が写っている') }],
      // X-Line-Retry-Key はLINE仕様でUUID形式が必須。接頭辞付きは実送信で失敗する。
      expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
      expect.any(Function),
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
      method: 'PUT', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'reject-other-1' },
      body: JSON.stringify({ accountId: 'account-a', status: 'rejected', expectedVersion: 1, reasonCode: 'quality' }),
    });
    expect(response.status).toBe(404);
    expect(batches).toHaveLength(0);
  });

  it('rejects inherited object property names as reason codes', async () => {
    const { app, batches } = harness();
    const response = await app.request('/api/nen-members/photos/photo-1/review', {
      method: 'PUT', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'reject-tostring-1' },
      body: JSON.stringify({ accountId: 'account-a', status: 'rejected', expectedVersion: 1, reasonCode: 'toString' }),
    });
    expect(response.status).toBe(400);
    expect(batches).toHaveLength(0);
  });

  it('keeps the review saved and records a failed LINE notification', async () => {
    mocks.push.mockRejectedValueOnce(new Error('LINE unavailable'));
    const { app, batches, runs } = harness();
    const response = await app.request('/api/nen-members/photos/photo-1/review', {
      method: 'PUT', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'reject-line-fail-1' },
      body: JSON.stringify({ accountId: 'account-a', status: 'rejected', expectedVersion: 1, reasonCode: 'quality' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { notificationStatus: 'failed' } });
    expect(mocks.complete).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      decisionId: expect.any(String), generation: 1, status: 'failed', error: 'LINE unavailable',
    }));
    const mirror = runs.find((entry) => entry.query.includes('review_notification_status'));
    expect(mirror?.bindings[0]).toBe('failed');
    expect(batches).toHaveLength(1);
  });

  it('returns a conflict when another reviewer decided first', async () => {
    const { app } = harness({ duplicate: true });
    const response = await app.request('/api/nen-members/photos/photo-1/review', {
      method: 'PUT', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'reject-conflict-1' },
      body: JSON.stringify({ accountId: 'account-a', status: 'rejected', expectedVersion: 1, reasonCode: 'duplicate' }),
    });
    expect(response.status).toBe(409);
  });

  it('commits approval and a single reward outbox entry before external EC processing', async () => {
    const { app, batches } = harness({ customerId: 'customer-1' });
    const response = await app.request('/api/nen-members/photos/photo-1/review', {
      method: 'PUT', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'approve-customer-1' },
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
    const { app, runs } = harness();
    const response = await app.request('/api/nen-members/photos/photo-1/notification/retry', {
      method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'retry-once-1' },
      body: JSON.stringify({ accountId: 'account-a' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { notificationStatus: 'sent', resent: true } });
    expect(mocks.push).toHaveBeenCalledWith(
      'https://worker.example', 'resolved-token', 'U1',
      [{ type: 'text', text: expect.stringContaining('人の顔や個人情報が写っている') }],
      // 再送も安定したUUID鍵（審査イベントID）で送る。
      'decision-1', expect.any(Function),
    );
    const mirror = runs.find((entry) => entry.query.includes('review_notification_status'));
    expect(mirror?.bindings[0]).toBe('sent');
    expect(mocks.claim).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      decisionId: 'decision-1', lineAccountId: 'account-a',
    }));
    expect(mocks.complete).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      decisionId: 'decision-1', generation: 1, status: 'sent',
    }));
  });

  it('does not resend when the notification is already settled as sent', async () => {
    const { app } = harness({
      retryRow: false,
      settledState: { notification_status: 'sent' },
    });
    const response = await app.request('/api/nen-members/photos/photo-1/notification/retry', {
      method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'retry-settled-1' },
      body: JSON.stringify({ accountId: 'account-a' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { notificationStatus: 'sent', resent: false } });
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('sends only once when two retries race on the same failed notification', async () => {
    // claimと確定を条件付きで原子に動かす行の代役。同期内に読み書きする。
    const row = { status: 'failed', generation: 0, error: null as string | null };
    let releasePush!: () => void;
    const pushGate = new Promise<void>((resolve) => { releasePush = resolve; });
    mocks.push.mockImplementationOnce(() => pushGate.then(() => undefined));
    mocks.claim.mockImplementation(async () => {
      if (row.status !== 'failed') return null;
      row.status = 'sending';
      row.generation += 1;
      return { generation: row.generation };
    });
    mocks.complete.mockImplementation(async (_db: unknown, input: {
      generation: number; status: 'sent' | 'failed'; error?: string | null;
    }) => {
      if (row.status !== 'sending' || input.generation !== row.generation) return false;
      row.status = input.status;
      row.error = input.status === 'failed' ? (input.error ?? '') : null;
      return true;
    });
    mocks.getState.mockImplementation(async () => ({
      decisionId: 'decision-1', status: row.status, error: row.error, generation: row.generation,
      leaseId: 'lease-x', leaseExpiresAt: null, attemptCount: 1,
    }));
    const { app } = harness();
    const body = JSON.stringify({ accountId: 'account-a' });
    // 連打・再試行は同じ再実行キーで届く想定（#931 N-313）。
    const headers = { 'content-type': 'application/json', 'Idempotency-Key': 'retry-race-1' };
    const first = app.request('/api/nen-members/photos/photo-1/notification/retry', { method: 'POST', headers, body });
    const second = app.request('/api/nen-members/photos/photo-1/notification/retry', { method: 'POST', headers, body });
    await Promise.resolve();
    await Promise.resolve();
    releasePush();
    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect([firstResponse.status, secondResponse.status].sort()).toEqual([200, 409]);
    expect(row.status).toBe('sent');
  });

  it('a late failure does not overwrite a concurrent success', async () => {
    const row = { status: 'sending', generation: 6, error: null as string | null };
    mocks.claim.mockResolvedValueOnce({ generation: 6 });
    mocks.push.mockImplementationOnce(async () => {
      // 送信中にleaseが切れ、別の処理が送達を確定させた想定にする。
      row.status = 'sent';
      row.generation = 7;
      throw new Error('late boom');
    });
    // 古い世代の確定は通らない。
    mocks.complete.mockResolvedValueOnce(false);
    mocks.getState.mockImplementation(async () => ({
      decisionId: 'decision-1', status: row.status, error: row.error, generation: row.generation,
      leaseId: null, leaseExpiresAt: null, attemptCount: 2,
    }));
    const { app, runs } = harness();
    const response = await app.request('/api/nen-members/photos/photo-1/notification/retry', {
      method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'retry-late-1' },
      body: JSON.stringify({ accountId: 'account-a' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { notificationStatus: 'sent' } });
    // 遅い失敗で上書きされず、成功が残る。
    expect(row).toMatchObject({ status: 'sent', generation: 7 });
    const mirror = runs.find((entry) => entry.query.includes('review_notification_status'));
    expect(mirror?.bindings[0]).toBe('sent');
  });

  it('returns a busy message instead of sending when another process holds the lease', async () => {
    mocks.claim.mockResolvedValueOnce(null);
    mocks.getState.mockResolvedValueOnce({
      decisionId: 'decision-1', status: 'sending', error: null, generation: 1,
      leaseId: 'lease-other', leaseExpiresAt: '2099-01-01T00:00:00.000Z', attemptCount: 1,
    });
    const { app } = harness();
    // 再送口のSELECTは失敗行を返すが、claimで負ける想定にする。
    const response = await app.request('/api/nen-members/photos/photo-1/notification/retry', {
      method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'retry-busy-1' },
      body: JSON.stringify({ accountId: 'account-a' }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('実行中') });
    expect(mocks.push).not.toHaveBeenCalled();
  });

  /*
   * #931 N-313: 単体審査と通知再送は再実行キー必須。連打・応答ロストの
   * やり直しが「別の担当者が更新しました」に化けないようにする。
   */
  it('requires an idempotency key for the individual review', async () => {
    const { app, batches } = harness();
    const response = await app.request('/api/nen-members/photos/photo-1/review', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 'account-a', status: 'adopted', expectedVersion: 1 }),
    });
    expect(response.status).toBe(400);
    expect(batches).toHaveLength(0);
  });

  it('replays the stored decision for the same idempotency key instead of erroring', async () => {
    const { app, batches } = harness({
      previousDecision: {
        to_status: 'adopted', reason_code: null, reason_note: null,
        awarded_points: 5, notification_status: 'sent',
      },
    });
    const response = await app.request('/api/nen-members/photos/photo-1/review', {
      method: 'PUT', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'same-key-1' },
      body: JSON.stringify({ accountId: 'account-a', status: 'adopted', expectedVersion: 2 }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true, duplicate: true,
      data: { awardedPoints: 5, notificationStatus: 'sent' },
    });
    // すでに保存済みの判断を、新しい判断として重ねて書かない。
    expect(batches).toHaveLength(0);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('rejects a reused idempotency key bound to a different decision', async () => {
    const { app, batches } = harness({
      previousDecision: {
        to_status: 'adopted', reason_code: null, reason_note: null,
        awarded_points: 5, notification_status: 'sent',
      },
    });
    const response = await app.request('/api/nen-members/photos/photo-1/review', {
      method: 'PUT', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'same-key-1' },
      body: JSON.stringify({ accountId: 'account-a', status: 'rejected', expectedVersion: 2, reasonCode: 'quality' }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(batches).toHaveLength(0);
  });

  it('records the submitter watch flag on the friend when asked (#931 N-312)', async () => {
    const { app, batches } = harness();
    const response = await app.request('/api/nen-members/photos/photo-1/review', {
      method: 'PUT', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'watch-sub-1' },
      body: JSON.stringify({
        accountId: 'account-a', status: 'rejected', expectedVersion: 1,
        reasonCode: 'privacy', watchSubmitter: true,
      }),
    });
    expect(response.status).toBe(200);
    const watch = batches[0].find((entry) => entry.query.includes('photo_watch_required'));
    expect(watch?.query).toContain('UPDATE friends');
    expect(watch?.bindings).toEqual(['2026-08-28 03:00:00', 'friend-1', 'account-a']);
  });

  it('omits the resubmission invite when unchecked (#931 N-312)', async () => {
    const { app, batches } = harness();
    const response = await app.request('/api/nen-members/photos/photo-1/review', {
      method: 'PUT', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'no-invite-1' },
      body: JSON.stringify({
        accountId: 'account-a', status: 'rejected', expectedVersion: 1,
        reasonCode: 'quality', resubmitInvite: false,
      }),
    });
    expect(response.status).toBe(200);
    const decision = batches[0].find((entry) => entry.query.includes('INSERT INTO nen_photo_review_events'));
    // resubmit_invite は判断へ 0 で残る。
    expect(decision?.bindings).toContain(0);
    const sentText = mocks.push.mock.calls[0]?.[3]?.[0]?.text as string;
    expect(sentText).not.toContain('別のお写真をご投稿ください');
  });

  it('does not tell an unconnected submitter that the point procedure started (#931 N-307)', async () => {
    const { app } = harness({ customerId: null });
    const response = await app.request('/api/nen-members/photos/photo-1/review', {
      method: 'PUT', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'approve-no-ec' },
      body: JSON.stringify({ accountId: 'account-a', status: 'adopted', expectedVersion: 1 }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { pointSync: 'needs_attention' } });
    const sentText = mocks.push.mock.calls[0]?.[3]?.[0]?.text as string;
    expect(sentText).toContain('お写真を採用しました');
    expect(sentText).not.toContain('ポイントを付ける手続きを始めました');
  });

  it('requires an idempotency key for the notification retry', async () => {
    const { app } = harness();
    const response = await app.request('/api/nen-members/photos/photo-1/notification/retry', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 'account-a' }),
    });
    expect(response.status).toBe(400);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('does not resend a retry that already delivered with the same key', async () => {
    const { app } = harness({ notificationRetryKey: 'retry-done-1' });
    const response = await app.request('/api/nen-members/photos/photo-1/notification/retry', {
      method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'retry-done-1' },
      body: JSON.stringify({ accountId: 'account-a' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true, duplicate: true, data: { resent: false },
    });
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  /*
   * #931 N-309: 詳細で直した向きを版つきで保存する。見た目だけの「回す」
   * は、通したあと元の向きへ戻ってしまうため。
   */
  it('saves the corrected rotation with version and idempotency', async () => {
    const { app, runs } = harness();
    const response = await app.request('/api/nen-members/photos/photo-1/rotation', {
      method: 'PUT', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'rotate-1' },
      body: JSON.stringify({ accountId: 'account-a', rotation: 90, expectedVersion: 1 }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { rotation: 90, reviewVersion: 2 } });
    const update = runs.find((entry) => entry.query.includes('display_rotation = ?'));
    expect(update?.bindings).toEqual([90, 'rotate-1', '2026-08-28 03:00:00', 'photo-1', 'account-a', 1]);
  });

  it('rejects invalid rotation values and missing keys', async () => {
    const { app, runs } = harness();
    const bad = await app.request('/api/nen-members/photos/photo-1/rotation', {
      method: 'PUT', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'rotate-bad' },
      body: JSON.stringify({ accountId: 'account-a', rotation: 45, expectedVersion: 1 }),
    });
    expect(bad.status).toBe(400);
    const noKey = await app.request('/api/nen-members/photos/photo-1/rotation', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 'account-a', rotation: 90, expectedVersion: 1 }),
    });
    expect(noKey.status).toBe(400);
    expect(runs).toHaveLength(0);
  });

  it('replays a stored rotation for the same key and conflicts on reuse with different input', async () => {
    const { app, runs } = harness({ savedRotation: 90, rotationKey: 'rotate-done' });
    const replay = await app.request('/api/nen-members/photos/photo-1/rotation', {
      method: 'PUT', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'rotate-done' },
      body: JSON.stringify({ accountId: 'account-a', rotation: 90, expectedVersion: 3 }),
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ duplicate: true, data: { rotation: 90 } });
    const conflict = await app.request('/api/nen-members/photos/photo-1/rotation', {
      method: 'PUT', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'rotate-done' },
      body: JSON.stringify({ accountId: 'account-a', rotation: 180, expectedVersion: 3 }),
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(runs).toHaveLength(0);
  });

  /*
   * #931 N-308: 一覧は名前・ペット名・コメントの部分一致で絞れる。
   * LIKE の記号（% _ \）は逃がして、検索語そのものにだけ当てる。
   */
  it('filters the photo list by owner, pet name and caption with escaped LIKE', async () => {
    const { app, statements } = harness();
    const response = await app.request('/api/nen-members/photos?accountId=account-a&q=50%25_%5C');
    expect(response.status).toBe(200);
    const list = statements.find((entry) => entry.query.includes('ORDER BY ps.created_at'));
    expect(list?.query).toContain("ps.caption LIKE ? ESCAPE '\\'");
    expect(list?.query).toContain("p.name LIKE ? ESCAPE '\\'");
    expect(list?.query).toContain("f.display_name LIKE ? ESCAPE '\\'");
    expect(list?.bindings).toEqual([
      'account-a', 'account-a', '%50\\%\\_\\\\%', '%50\\%\\_\\\\%', '%50\\%\\_\\\\%', 200, 0,
    ]);
  });

  it('keeps the list query unchanged when no search term is given', async () => {
    const { app, statements } = harness();
    const response = await app.request('/api/nen-members/photos?accountId=account-a');
    expect(response.status).toBe(200);
    const list = statements.find((entry) => entry.query.includes('ORDER BY ps.created_at'));
    expect(list?.query).not.toContain('LIKE');
    expect(list?.bindings).toEqual(['account-a', 'account-a', 200, 0]);
  });
});
