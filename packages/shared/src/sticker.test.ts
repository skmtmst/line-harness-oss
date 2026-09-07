import { describe, expect, it } from 'vitest';
import { createStickerMessageContent, isAllowedStickerUrl, parseStickerMessageContent } from './sticker.js';

describe('sticker message content', () => {
  it('LINE公式のHTTPSスタンプURLだけを許可する', () => {
    const content = createStickerMessageContent({ packageId: '1', stickerId: '2' });
    expect(content).not.toBeNull();
    expect(isAllowedStickerUrl(content!.stickerUrl)).toBe(true);
    expect(parseStickerMessageContent(JSON.stringify(content))).toEqual(content);
  });

  it.each([
    'http://stickershop.line-scdn.net/stickershop/v1/sticker/2/iPhone/sticker@2x.png',
    'https://example.com/stickershop/v1/sticker/2/iPhone/sticker@2x.png',
    'https://stickershop.line-scdn.net.evil.example/stickershop/v1/sticker/2/iPhone/sticker@2x.png',
    'javascript:alert(1)',
  ])('許可外URLを表示用データとして返さない: %s', (stickerUrl) => {
    expect(parseStickerMessageContent(JSON.stringify({
      type: 'sticker', stickerId: '2', stickerUrl, fallback: '[スタンプ]',
    }))).toBeNull();
  });
});
