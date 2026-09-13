import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  getFriendById: vi.fn(),
  getLineAccountById: vi.fn(),
  jstNow: vi.fn(() => '2026-08-28 01:00:00'),
  // 取り出しのSQLに混ぜる「機能オフのアカウントを外す」条件式。
  // ここでは常に偽(=誰も外さない)にして、この試験の関心事だけを見る。
  accountFeatureOffExclusionSql: vi.fn(() => '(0)'),
}));
const pushViaHarnessProxy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const logOutgoingMessage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@line-crm/db', () => dbMocks);
vi.mock('./feature-enforcement.js', () => ({
  featureJobCanRun: async () => true,
  createFeatureJobGate: () => ({ canRun: async () => true }),
}));
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

function createDb(
  lineAccountId = 'account-a',
  retryGeneration = 0,
  options: { campaign?: typeof campaign; alreadyResponded?: boolean } = {},
) {
  const updates: Array<{ sql: string; values: unknown[] }> = [];
  const selectedCampaign = options.campaign ?? campaign;
  const job = {
    id: 'job-1', campaign_key: selectedCampaign.campaign_key, friend_id: 'friend-1',
    line_account_id: lineAccountId, source_key: 'order:1',
    payload: JSON.stringify({}),
    campaign_snapshot: JSON.stringify({ ...selectedCampaign, title: '予約時の見出し' }),
    retry_generation: retryGeneration,
  };
  const db = {
    prepare(sql: string) {
      let values: unknown[] = [];
      return {
        bind(...bound: unknown[]) { values = bound; return this; },
        async all() {
          // 機能オフの行だけを読む監査用の問い合わせ。ここでは0件。
          if (sql.includes('SELECT line_account_id FROM nen_delivery_jobs')) {
            return { results: [] };
          }
          if (sql.includes('FROM nen_delivery_jobs')) return { results: [job] };
          return { results: [] };
        },
        async first() {
          if (sql.includes('FROM nen_campaign_settings')) return selectedCampaign;
          if (sql.includes('FROM form_submissions')) return options.alreadyResponded ? { found: 1 } : null;
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

  it('uses a new idempotency key for each manual retry generation', async () => {
    const { db } = createDb('account-a', 2);
    dbMocks.getFriendById.mockResolvedValue({
      id: 'friend-1', line_user_id: 'U1', line_account_id: 'account-a', is_following: 1,
    });
    dbMocks.getLineAccountById.mockResolvedValue({ id: 'account-a', channel_access_token: 'account-token' });

    await processNenDeliveries(db, {
      proxyBaseUrl: 'https://proxy.example.com', defaultAccessToken: 'must-not-be-used',
    });

    expect(pushViaHarnessProxy).toHaveBeenCalledWith(
      'https://proxy.example.com', 'account-token', 'U1', expect.any(Array),
      'job-1:manual:2', undefined,
    );
  });

  it('skips a queued review request when the friend responds before delivery', async () => {
    const reviewCampaign = {
      ...campaign,
      campaign_key: 'review_request',
      exclude_form_respondents: 1,
      after_actions: [{
        kind: 'open_form' as const,
        formId: 'review-form',
        formName: '口コミ',
        buttonLabel: '回答する',
      }],
    };
    const { db, updates } = createDb('account-a', 0, {
      campaign: reviewCampaign,
      alreadyResponded: true,
    });
    dbMocks.getFriendById.mockResolvedValue({
      id: 'friend-1', line_user_id: 'U1', line_account_id: 'account-a', is_following: 1,
    });
    dbMocks.getLineAccountById.mockResolvedValue({ id: 'account-a', channel_access_token: 'account-token' });

    await expect(processNenDeliveries(db, {
      proxyBaseUrl: 'https://proxy.example.com', defaultAccessToken: 'must-not-be-used',
    })).resolves.toEqual({ sent: 0, failed: 0, skipped: 1 });

    expect(pushViaHarnessProxy).not.toHaveBeenCalled();
    expect(updates).toContainEqual(expect.objectContaining({
      sql: expect.stringContaining("status = 'skipped'"),
      values: ['campaign_form_already_submitted', '2026-08-28 01:00:00', 'job-1'],
    }));
  });
});
