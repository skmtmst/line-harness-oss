import { describe, expect, it } from 'vitest';
import { validatePayload } from './broadcast-message-assets.js';

describe('broadcast message asset validation', () => {
  it('accepts a rich message with an image', () => {
    expect(validatePayload('rich_message', { imageUrl: 'https://example.com/image.jpg', tapAreas: [] })).toBeNull();
  });

  it('requires one to ten panels', () => {
    // 画面は10枚まで作れる表示。上限を9のままにすると、作り終えてから
    // 保存できない（監査 R141）。
    expect(validatePayload('card_message', { cards: [] })).toContain('1〜10');
    expect(validatePayload('card_message', { cards: Array.from({ length: 11 }, () => ({})) })).toContain('1〜10');
    expect(validatePayload('card_message', { cards: Array.from({ length: 10 }, () => ({ title: '商品' })) })).toBeNull();
  });

  it('counts the more panel in the limit and explains how to fix it', () => {
    // 「もっと見る」もLINEの10列のうち1列を使う。10枚＋もっと見るは
    // 送れないので、保存の時点で理由と直し方を出す（監査 R141・R143）。
    const ten = Array.from({ length: 10 }, () => ({ title: '商品' }));
    const error = validatePayload('card_message', { cards: ten, moreCard: true });
    expect(error).toContain('9枚');
    expect(validatePayload('card_message', { cards: ten.slice(0, 9), moreCard: true })).toBeNull();
  });

  it('requires a title per panel', () => {
    expect(validatePayload('card_message', { cards: [{ title: '商品' }, { title: '' }] })).toContain('パネル2');
  });

  it('rejects non-object payloads', () => {
    expect(validatePayload('coupon', null)).toBe('payload must be an object');
  });
});
