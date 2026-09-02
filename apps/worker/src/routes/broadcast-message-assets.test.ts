import { describe, expect, it } from 'vitest';
import { validatePayload } from './broadcast-message-assets.js';

describe('broadcast message asset validation', () => {
  it('accepts a rich message with an image', () => {
    expect(validatePayload('rich_message', { imageUrl: 'https://example.com/image.jpg', tapAreas: [] })).toBeNull();
  });

  it('requires one to nine cards', () => {
    expect(validatePayload('card_message', { cards: [] })).toContain('1〜9');
    expect(validatePayload('card_message', { cards: Array.from({ length: 10 }, () => ({})) })).toContain('1〜9');
    expect(validatePayload('card_message', { cards: [{ title: '商品' }] })).toBeNull();
  });

  it('rejects non-object payloads', () => {
    expect(validatePayload('coupon', null)).toBe('payload must be an object');
  });
});
