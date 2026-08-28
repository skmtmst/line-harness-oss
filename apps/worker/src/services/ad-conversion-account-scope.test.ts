import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  getActiveAdPlatforms: vi.fn(),
  getRefTrackingWithClickIds: vi.fn(),
  logAdConversion: vi.fn(),
}));
vi.mock('@line-crm/db', () => dbMocks);

const { sendAdConversions } = await import('./ad-conversion.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('広告成果送信のLINEアカウント境界', () => {
  it('アカウント未選択では友だちも広告接続も読まない', async () => {
    const prepare = vi.fn();

    await sendAdConversions({ prepare } as unknown as D1Database, 'friend-a', 'Purchase');

    expect(prepare).not.toHaveBeenCalled();
    expect(dbMocks.getActiveAdPlatforms).not.toHaveBeenCalled();
  });

  it('選択中アカウントに属さない友だちを外部送信へ流さない', async () => {
    const first = vi.fn(async () => null);
    const bind = vi.fn(() => ({ first }));
    const prepare = vi.fn(() => ({ bind }));

    await sendAdConversions(
      { prepare } as unknown as D1Database,
      'friend-b',
      'Purchase',
      undefined,
      'account-a',
    );

    expect(bind).toHaveBeenCalledWith('friend-b', 'account-a');
    expect(dbMocks.getRefTrackingWithClickIds).not.toHaveBeenCalled();
    expect(dbMocks.getActiveAdPlatforms).not.toHaveBeenCalled();
  });

  it('広告接続を友だちと同じアカウントだけから読む', async () => {
    const first = vi.fn(async () => ({ id: 'friend-a' }));
    const bind = vi.fn(() => ({ first }));
    const prepare = vi.fn(() => ({ bind }));
    dbMocks.getRefTrackingWithClickIds.mockResolvedValue(null);

    await sendAdConversions(
      { prepare } as unknown as D1Database,
      'friend-a',
      'Purchase',
      undefined,
      'account-a',
    );

    expect(dbMocks.getRefTrackingWithClickIds).toHaveBeenCalledWith(expect.anything(), 'friend-a');
    expect(dbMocks.getActiveAdPlatforms).not.toHaveBeenCalled();

    dbMocks.getRefTrackingWithClickIds.mockResolvedValue({ gclid: 'click-a' });
    dbMocks.getActiveAdPlatforms.mockResolvedValue([]);
    await sendAdConversions(
      { prepare } as unknown as D1Database,
      'friend-a',
      'Purchase',
      undefined,
      'account-a',
    );
    expect(dbMocks.getActiveAdPlatforms).toHaveBeenCalledWith(expect.anything(), 'account-a');
  });
});
