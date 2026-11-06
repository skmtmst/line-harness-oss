import { describe, expect, it } from 'vitest';
import { restaurantChannelState, restaurantDayBounds } from './restaurant-channels.js';

describe('店舗の受信日と経路の状態', () => {
  it('日本時間の日付境界をUTCに直す', () => {
    expect(restaurantDayBounds('Asia/Tokyo', new Date('2026-10-01T16:00:00Z'))).toEqual(['2026-10-01T15:00:00.000Z', '2026-10-02T15:00:00.000Z']);
  });
  it('夏時間の切替日にも店舗の一日を使う', () => {
    expect(restaurantDayBounds('America/New_York', new Date('2026-03-08T12:00:00Z'))).toEqual(['2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z']);
  });
  it('未受信・準備中とN日未受信を区別する', () => {
    const now = new Date('2026-10-02T12:00:00Z');
    expect(restaurantChannelState('2026-09-29 10:00:00', true, now)).toEqual({ status: 'not_receiving', daysWithoutReceipt: 3 });
    expect(restaurantChannelState(null, true, now).status).toBe('preparing');
    expect(restaurantChannelState(now.toISOString(), false, now).status).toBe('preparing');
  });
});
