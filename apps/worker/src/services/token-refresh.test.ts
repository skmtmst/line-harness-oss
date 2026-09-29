import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getLineAccounts, updateLineAccount, updateLineAccountFields, fetchBotProfile } = vi.hoisted(() => ({
  getLineAccounts: vi.fn(),
  updateLineAccount: vi.fn(),
  updateLineAccountFields: vi.fn(),
  fetchBotProfile: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  getLineAccounts,
  updateLineAccount,
  updateLineAccountFields,
}));

vi.mock('../lib/bot-profile.js', () => ({ fetchBotProfile }));

import type { LineAccount } from '@line-crm/db';
import { refreshLineAccessTokens } from './token-refresh.js';

function account(id: string, syncedAt: string | null): LineAccount {
  return {
    id,
    name: `Account ${id}`,
    channel_id: `channel-${id}`,
    channel_secret: `secret-${id}`,
    channel_access_token: `token-${id}`,
    token_expires_at: '2026-10-31T00:00:00+09:00',
    line_profile_synced_at: syncedAt,
    is_active: 1,
  } as LineAccount;
}

describe('refreshLineAccessTokens profile sync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T03:00:00Z'));
    vi.clearAllMocks();
    updateLineAccountFields.mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('syncs profiles daily even when tokens are fresh and continues after one DB failure', async () => {
    getLineAccounts.mockResolvedValue([
      account('old-1', '2026-09-13T12:00:00+09:00'),
      account('old-2', null),
      account('fresh', '2026-09-15T11:00:00+09:00'),
    ]);
    fetchBotProfile
      .mockResolvedValueOnce({ displayName: 'First', pictureUrl: 'https://example.com/1.jpg', basicId: '@first' })
      .mockResolvedValueOnce({ displayName: 'Second', basicId: '@second' });
    updateLineAccountFields.mockRejectedValueOnce(new Error('temporary D1 error'));

    await refreshLineAccessTokens({} as D1Database);

    expect(updateLineAccount).not.toHaveBeenCalled();
    expect(fetchBotProfile).toHaveBeenCalledTimes(2);
    expect(fetchBotProfile).toHaveBeenNthCalledWith(1, 'token-old-1');
    expect(fetchBotProfile).toHaveBeenNthCalledWith(2, 'token-old-2');
    expect(updateLineAccountFields).toHaveBeenCalledTimes(2);
    expect(updateLineAccountFields).toHaveBeenLastCalledWith(
      expect.anything(),
      'old-2',
      expect.objectContaining({
        lineDisplayName: 'Second',
        lineBasicId: '@second',
      }),
    );
  });
});
