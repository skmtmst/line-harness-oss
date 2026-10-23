import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { updateLineAccount, updateLineAccountFields, fetchBotProfile } = vi.hoisted(() => ({
  updateLineAccount: vi.fn(),
  updateLineAccountFields: vi.fn(),
  fetchBotProfile: vi.fn(),
}));

vi.mock('@line-crm/db', async original => ({
  ...await original<typeof import('@line-crm/db')>(),
  updateLineAccount,
  updateLineAccountFields,
}));

vi.mock('../lib/bot-profile.js', () => ({ fetchBotProfile }));

import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { refreshLineAccessTokens } from './token-refresh.js';

describe('refreshLineAccessTokens profile sync', () => {
  let fixture: ReturnType<typeof createTestD1>;
  beforeEach(() => {
    fixture = createTestD1();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T03:00:00Z'));
    vi.clearAllMocks();
    updateLineAccountFields.mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    fixture.raw.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('syncs profiles daily even when tokens are fresh and continues after one DB failure', async () => {
    fixture.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_secret,channel_access_token,token_expires_at,line_profile_synced_at)
      VALUES('old-1','channel-old-1','First','secret','token-old-1','2026-10-31T00:00:00+09:00','2026-09-13T12:00:00+09:00'),
        ('old-2','channel-old-2','Second','secret','token-old-2','2026-10-31T00:00:00+09:00','2026-09-12T12:00:00+09:00'),
        ('fresh','channel-fresh','Fresh','secret','token-fresh','2026-10-31T00:00:00+09:00','2026-09-15T11:00:00+09:00')`);
    fetchBotProfile
      .mockResolvedValueOnce({ displayName: 'First', pictureUrl: 'https://example.com/1.jpg', basicId: '@first' })
      .mockResolvedValueOnce({ displayName: 'Second', basicId: '@second' });
    updateLineAccountFields.mockRejectedValueOnce(new Error('temporary D1 error'));

    await refreshLineAccessTokens(fixture.db);

    expect(updateLineAccount).not.toHaveBeenCalled();
    expect(fetchBotProfile).toHaveBeenCalledTimes(2);
    expect(fetchBotProfile).toHaveBeenNthCalledWith(1, 'token-old-2');
    expect(fetchBotProfile).toHaveBeenNthCalledWith(2, 'token-old-1');
    expect(updateLineAccountFields).toHaveBeenCalledTimes(2);
    expect(updateLineAccountFields).toHaveBeenLastCalledWith(
      expect.anything(),
      'old-1',
      expect.objectContaining({
        lineDisplayName: 'Second',
        lineBasicId: '@second',
      }),
    );
  });
});
