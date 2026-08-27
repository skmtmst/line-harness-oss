import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@line-crm/db', () => ({
  getActiveAdPlatforms: vi.fn().mockResolvedValue([{
    id: 'platform-1',
    name: 'meta',
    config: JSON.stringify({ pixel_id: 'pixel-1', access_token: 'secret' }),
  }]),
  getRefTrackingWithClickIds: vi.fn().mockResolvedValue({
    fbclid: 'click-1', twclid: null, gclid: null, ttclid: null,
    ip_address: null, user_agent: null,
  }),
  isOperationCapabilityStopped: vi.fn().mockResolvedValue(false),
  logAdConversion: vi.fn().mockResolvedValue(undefined),
  recordOperationTargetOutcomeAcrossStop: vi.fn().mockResolvedValue(0),
}));

import {
  logAdConversion,
  recordOperationTargetOutcomeAcrossStop,
} from '@line-crm/db';
import { sendAdConversions } from './ad-conversion.js';

function fakeDb(): D1Database {
  return {
    prepare() {
      return {
        bind() { return this; },
        async first() { return { line_account_id: 'account-1' }; },
      };
    },
  } as unknown as D1Database;
}

describe('広告成果送信と緊急停止の交差記録', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('送信完了を開始時刻・完了時刻つきで停止履歴へ渡す', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    const db = fakeDb();

    await sendAdConversions(db, 'friend-1', 'purchase', 1000);

    expect(logAdConversion).toHaveBeenCalledWith(db, expect.objectContaining({ status: 'sent' }));
    expect(recordOperationTargetOutcomeAcrossStop).toHaveBeenCalledWith(db, expect.objectContaining({
      lineAccountId: 'account-1',
      capability: 'ad_postback',
      targetType: 'ad_conversion',
      targetId: 'friend-1:purchase:platform-1',
      result: 'in_flight',
      startedAt: expect.any(String),
      completedAt: expect.any(String),
    }));
  });

  it('送信失敗を失敗実績として停止履歴へ渡す', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('failed', { status: 500 })));
    const db = fakeDb();

    await sendAdConversions(db, 'friend-1', 'purchase');

    expect(logAdConversion).toHaveBeenCalledWith(db, expect.objectContaining({
      status: 'failed',
      errorMessage: expect.stringContaining('Meta CAPI error: 500'),
    }));
    expect(recordOperationTargetOutcomeAcrossStop).toHaveBeenCalledWith(db, expect.objectContaining({
      result: 'failed',
      startedAt: expect.any(String),
      completedAt: expect.any(String),
    }));
  });
});
