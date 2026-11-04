import { performance } from 'node:perf_hooks';
import { describe, expect, test } from 'vitest';
import { mediaReferenceCandidates } from '../src/media/deletion-guard.js';

describe('画像参照の候補抽出', () => {
  test.each([100, 300])('%i 個の吹き出しでも D1 の引数上限に収まる', count => {
    // 約 10KB / 30KB の本文で、抽出後に実際に D1 に渡す JSON の UTF-8 バイト数と経過時間を測る。
    const body = JSON.stringify(Array.from({ length: count }, (_, i) => ({
      text: `説明 ${'文章です'.repeat(3)} https://example.invalid/images/tenant/${i}/photo.png`,
    })));
    expect(Buffer.byteLength(body, 'utf8')).toBeGreaterThan(count === 100 ? 9_000 : 29_000);
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThan(count === 100 ? 13_000 : 36_000);
    const started = performance.now();
    const candidates = mediaReferenceCandidates([body]);
    const elapsed = performance.now() - started;
    const argumentBytes = Buffer.byteLength(JSON.stringify(candidates), 'utf8');
    process.stdout.write(`media-candidates bubbles=${count} body-bytes=${Buffer.byteLength(body, 'utf8')} argument-bytes=${argumentBytes} elapsed-ms=${elapsed.toFixed(1)}\n`);
    expect(argumentBytes).toBeLessThan(1_500_000);
    expect(elapsed).toBeLessThan(2_000);
    expect(candidates).toContain(`images/tenant/${count - 1}/photo.png`);
  });

  test('単独の画像 ID と URL の参照を残す', () => {
    expect(mediaReferenceCandidates(['image-id', '文章 https://host.invalid/api/media/image-id/content'])).toContain('image-id');
    expect(mediaReferenceCandidates(['media/old image.png'])).toContain('media/old image.png');
    expect(mediaReferenceCandidates(['https://host.invalid/images/media/old%20image.png'])).toContain('media/old image.png');
    expect(mediaReferenceCandidates(['media/old%20image.png'])).toContain('media/old%20image.png');
  });

  test('長すぎるパスや多すぎる候補は黙って捨てず保存を拒む', () => {
    expect(() => mediaReferenceCandidates([`images/${'x'.repeat(2049)}`])).toThrow('media_reference_limit_exceeded');
    const paths = Array.from({ length: 4097 }, (_, i) => `images/${i}.png`).join(' ');
    expect(() => mediaReferenceCandidates([paths])).toThrow('media_reference_limit_exceeded');
  });
});
