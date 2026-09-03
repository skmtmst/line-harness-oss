import { describe, expect, it } from 'vitest';
import { restaurantTestEnabled } from './environment-features.js';

describe('環境限定機能', () => {
  it.each([undefined, '', 'false', '0', 'yes', 'TRUEE'])(
    '飲食店テストは明示的なtrue以外で無効: %s',
    (value) => expect(restaurantTestEnabled({ RESTAURANT_TEST_ENABLED: value })).toBe(false),
  );

  it.each(['true', 'TRUE', ' true '])('明示的なtrueだけ有効: %s', (value) => {
    expect(restaurantTestEnabled({ RESTAURANT_TEST_ENABLED: value })).toBe(true);
  });
});
