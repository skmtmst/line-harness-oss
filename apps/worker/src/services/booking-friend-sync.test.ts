import { describe, expect, test } from 'vitest';
import { bookingStoreTag } from './booking-friend-sync.js';

describe('bookingStoreTag', () => {
  test('甲府を含む店舗名は甲府店タグに正規化する', () => {
    expect(bookingStoreTag('meauty 甲府店')).toEqual({
      name: '甲府店',
      color: '#F59E0B',
    });
  });

  test('渋谷を含む店舗名は渋谷店タグに正規化する', () => {
    expect(bookingStoreTag('渋谷松濤店')).toEqual({
      name: '渋谷店',
      color: '#6366F1',
    });
  });
});
