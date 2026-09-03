import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

const dbMocks = {
  getBroadcasts: vi.fn(),
  getBroadcastById: vi.fn(),
  createBroadcast: vi.fn(),
  updateBroadcast: vi.fn(),
  deleteBroadcast: vi.fn(),
  getLineAccountById: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
  getVisibleLineAccountScope: vi.fn(async () => ({
    accounts: [],
    ids: ['account-1'],
    allowedAccountIds: ['account-1'],
    canSeeUnassigned: true,
  })),
}));

const { broadcasts } = await import('./broadcasts.js');

const KEY = '11111111-2222-4333-8444-555555555555';
const requestBody = {
  title: '朝のお知らせ',
  messageType: 'text',
  messageContent: '{{name}}さん、おはようございます',
  targetType: 'all',
  scheduledAt: '2026-08-12T09:00:00.000+09:00',
  lineAccountId: 'account-1',
  trackLinks: true,
};

const row = {
  id: KEY,
  title: requestBody.title,
  message_type: requestBody.messageType,
  message_content: requestBody.messageContent,
  target_type: requestBody.targetType,
  target_tag_id: null,
  status: 'scheduled',
  scheduled_at: requestBody.scheduledAt,
  sent_at: null,
  total_count: 0,
  success_count: 0,
  created_at: '2026-08-11T12:00:00.000+09:00',
  account_ids: null,
  dedup_priority: null,
  failed_account_ids: null,
  dedup_progress: null,
  batch_lock_at: null,
  track_links: 1,
  line_account_id: requestBody.lineAccountId,
  alt_text: null,
};

function setupApp() {
  const app = new Hono<{ Bindings: { DB: D1Database } }>();
  app.use('*', async (c, next) => {
    c.env = {
      DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({ run: vi.fn(async () => ({ success: true, meta: { changes: 1 } })) })),
        })),
      } as unknown as D1Database,
    };
    // 更新系はオーナー／管理者限定になった。ここで見たいのは本体の挙動なので、
    // 認証は通った状態にしてから渡す。権限の検証は role-guard.test.ts が持つ。
    (c as unknown as { set: (k: string, v: unknown) => void }).set('staff', { id: 'owner-1', name: 'Owner', role: 'owner' as const, readOnly: false });
    await next();
  });
  app.route('/', broadcasts);
  return app;
}

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
});
describe('POST /api/broadcasts idempotency', () => {
  test('accepts five validated message bubbles and rejects six before writing', async () => {
    const five = Array.from({ length: 5 }, (_, index) => ({
      id: `bubble-${index + 1}`,
      type: 'text',
      content: { text: `本文${index + 1}` },
    }));
    dbMocks.createBroadcast.mockResolvedValueOnce({
      ...row,
      message_bubbles_json: JSON.stringify(five),
    });
    const accepted = await setupApp().request('/api/broadcasts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...requestBody, messageBubbles: five }),
    });
    expect(accepted.status).toBe(201);
    expect(dbMocks.createBroadcast).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      messageBubblesJson: JSON.stringify(five),
    }));

    dbMocks.createBroadcast.mockClear();
    const rejected = await setupApp().request('/api/broadcasts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...requestBody, messageBubbles: [...five, five[0]] }),
    });
    expect(rejected.status).toBe(400);
    expect(dbMocks.createBroadcast).not.toHaveBeenCalled();
  });

  test('rejects an unsupported bubble instead of storing content that cannot be sent', async () => {
    const response = await setupApp().request('/api/broadcasts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...requestBody,
        messageBubbles: [{ id: 'coupon-1', type: 'coupon', content: { assetId: 'coupon-1' } }],
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, error: expect.stringContaining('Unsupported') });
    expect(dbMocks.createBroadcast).not.toHaveBeenCalled();
  });

  test('creates with the idempotency key as the stable broadcast id', async () => {
    dbMocks.getBroadcastById.mockResolvedValueOnce(null);
    dbMocks.createBroadcast.mockResolvedValueOnce(row);

    const response = await setupApp().request('/api/broadcasts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': KEY },
      body: JSON.stringify(requestBody),
    });

    expect(response.status).toBe(201);
    expect(dbMocks.createBroadcast).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      id: KEY,
      lineAccountId: 'account-1',
      messageContent: requestBody.messageContent,
    }));
  });

  test('returns the original row without creating a duplicate on replay', async () => {
    dbMocks.getBroadcastById.mockResolvedValueOnce(row);

    const response = await setupApp().request('/api/broadcasts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': KEY },
      body: JSON.stringify(requestBody),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Idempotency-Replayed')).toBe('true');
    expect(dbMocks.createBroadcast).not.toHaveBeenCalled();
    expect((await response.json() as { data: { id: string } }).data.id).toBe(KEY);
  });

  test('rejects reuse of the same key for different content', async () => {
    dbMocks.getBroadcastById.mockResolvedValueOnce(row);

    const response = await setupApp().request('/api/broadcasts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': KEY },
      body: JSON.stringify({ ...requestBody, messageContent: '別の内容' }),
    });

    expect(response.status).toBe(409);
    expect(dbMocks.createBroadcast).not.toHaveBeenCalled();
  });

  test('rejects a malformed key before touching the database', async () => {
    const response = await setupApp().request('/api/broadcasts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'not-a-uuid' },
      body: JSON.stringify(requestBody),
    });

    expect(response.status).toBe(400);
    expect(dbMocks.getBroadcastById).not.toHaveBeenCalled();
    expect(dbMocks.createBroadcast).not.toHaveBeenCalled();
  });
});

describe('PUT /api/broadcasts/:id', () => {
  test('updates the same draft with bubbles, segment conditions, and send pacing', async () => {
    const draft = { ...row, status: 'draft', scheduled_at: null };
    dbMocks.getBroadcastById.mockResolvedValueOnce(draft);
    dbMocks.updateBroadcast.mockResolvedValueOnce({
      ...draft,
      message_bubbles_json: '[{"type":"text"}]',
      segment_conditions: '{"operator":"AND","rules":[]}',
      stealth_spread_minutes: 45,
    });

    const response = await setupApp().request(`/api/broadcasts/${KEY}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messageBubbles: [{ id: 'b-1', type: 'text', content: { text: '更新後' } }],
        targetType: 'segment',
        segmentConditions: { operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-1' }] },
        stealthSpreadMinutes: 45,
      }),
    });

    expect(response.status).toBe(200);
    expect(dbMocks.updateBroadcast).toHaveBeenCalledWith(
      expect.anything(),
      KEY,
      expect.objectContaining({
        message_bubbles_json: expect.stringContaining('更新後'),
        target_type: 'segment',
        segment_conditions: expect.stringContaining('tag_exists'),
        stealth_spread_minutes: 45,
      }),
    );
  });

  test('does not update a segment draft when its conditions cannot be evaluated', async () => {
    dbMocks.getBroadcastById.mockResolvedValueOnce({ ...row, status: 'draft', scheduled_at: null });
    const response = await setupApp().request(`/api/broadcasts/${KEY}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetType: 'segment',
        segmentConditions: { operator: 'AND', rules: [{ type: 'unknown_rule', value: true }] },
      }),
    });

    expect(response.status).toBe(400);
    expect(dbMocks.updateBroadcast).not.toHaveBeenCalled();
  });
});
