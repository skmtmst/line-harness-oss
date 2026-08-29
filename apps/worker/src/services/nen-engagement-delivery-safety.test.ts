import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  getFriendById: vi.fn(),
  getLineAccountById: vi.fn(),
  jstNow: vi.fn(() => '2026-08-28 01:00:00'),
}));
const pushViaHarnessProxy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const logOutgoingMessage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@line-crm/db', () => dbMocks);
vi.mock('./line-proxy-send.js', () => ({ pushViaHarnessProxy }));
vi.mock('./event-bus.js', () => ({ logOutgoingMessage }));

const { processNenDeliveries } = await import('./nen-engagement.js');

const campaign = {
  campaign_key: 'arrival_check',
  label: '到着後の確認',
  category: 'follow_up',
  delay_days: 0,
  delivery_time: '10:00',
  is_enabled: 1,
  title: '現在の見出し',
  body_text: '現在の本文',
  button_label: null,
  button_url: null,
  image_url: null,
};

function createDb(lineAccountId = 'account-a') {
  const updates: Array<{ sql: string; values: unknown[] }> = [];
  const job = {
    id: 'job-1', campaign_key: 'arrival_check', friend_id: 'friend-1',
    line_account_id: lineAccountId, source_key: 'order:1',
    payload: JSON.stringify({}),
    campaign_snapshot: JSON.stringify({ ...campaign, title: '予約時の見出し' }),
  };
  const db = {
    prepare(sql: string) {
      let values: unknown[] = [];
      return {
        bind(...bound: unknown[]) { values = bound; return this; },
        async all() {
          if (sql.includes('FROM nen_delivery_jobs')) return { results: [job] };
          return { results: [] };
        },
        async first() {
          if (sql.includes('FROM nen_campaign_settings')) return campaign;
          return null;
        },
        async run() {
          updates.push({ sql, values });
          return { success: true, meta: { changes: 1 } };
        },
      };
    },
  } as unknown as D1Database;
  return { db, updates };
}

describe('processNenDeliveries account and snapshot safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pushViaHarnessProxy.mockResolvedValue(undefined);
  });

  it('stops a job when the friend belongs to another LINE account', async () => {
    const { db, updates } = createDb('account-a');
    dbMocks.getFriendById.mockResolvedValue({
      id: 'friend-1', line_user_id: 'U1', line_account_id: 'account-b', is_following: 1,
    });
    dbMocks.getLineAccountById.mockResolvedValue({ id: 'account-a', channel_access_token: 'account-token' });

    await expect(processNenDeliveries(db, {
      proxyBaseUrl: 'https://proxy.example.com', defaultAccessToken: 'must-not-be-used',
    })).resolves.toEqual({ sent: 0, failed: 0, skipped: 1 });

    expect(pushViaHarnessProxy).not.toHaveBeenCalled();
    expect(updates).toContainEqual(expect.objectContaining({
      sql: expect.stringContaining("status = 'skipped'"),
      values: ['line_account_mismatch', '2026-08-28 01:00:00', 'job-1'],
    }));
  });

  it('uses the account token and queued snapshot instead of the edited current copy', async () => {
    const { db } = createDb('account-a');
    dbMocks.getFriendById.mockResolvedValue({
      id: 'friend-1', line_user_id: 'U1', line_account_id: 'account-a', is_following: 1,
    });
    dbMocks.getLineAccountById.mockResolvedValue({ id: 'account-a', channel_access_token: 'account-token' });

    await expect(processNenDeliveries(db, {
      proxyBaseUrl: 'https://proxy.example.com', defaultAccessToken: 'must-not-be-used',
    })).resolves.toEqual({ sent: 1, failed: 0, skipped: 0 });

    expect(pushViaHarnessProxy).toHaveBeenCalledWith(
      'https://proxy.example.com', 'account-token', 'U1',
      expect.arrayContaining([expect.objectContaining({ type: 'flex', altText: '予約時の見出し' })]),
      'job-1', undefined,
    );
    expect(JSON.stringify(pushViaHarnessProxy.mock.calls[0]?.[3])).not.toContain('現在の見出し');
  });
});
