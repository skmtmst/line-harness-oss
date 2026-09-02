import { describe, expect, it, vi } from 'vitest';
import { createEccubeCoupon } from './eccube-coupon.js';

describe('createEccubeCoupon', () => {
  it('signs and sends a percentage coupon payload', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 201 }));

    await createEccubeCoupon('https://stg.nen-petfood.com/', 's'.repeat(32), {
      code: 'NENLINE-ABCDEF123456',
      name: 'LINE友だち追加 5%OFF',
      discountType: 'rate',
      discountRate: 5,
      validFrom: '2026-09-02T11:00:00+09:00',
      validTo: '2026-10-03T11:00:00+09:00',
      memberOnly: false,
    }, fetcher as typeof fetch);

    const [url, init] = fetcher.mock.calls[0]!;
    expect(init).toBeDefined();
    const request = init!;
    expect(url).toBe('https://stg.nen-petfood.com/line-harness/coupons');
    expect(request.method).toBe('POST');
    expect(request.headers).toEqual(expect.objectContaining({
      'X-Nen-Timestamp': expect.stringMatching(/^\d+$/),
      'X-Nen-Signature': expect.stringMatching(/^sha256=[a-f0-9]{64}$/),
    }));
    expect(JSON.parse(String(request.body))).toMatchObject({
      discountType: 'rate', discountRate: 5, memberOnly: false,
    });
  });

  it('treats an existing code as an idempotent retry', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 409 }));
    await expect(createEccubeCoupon('https://example.com', 's'.repeat(32), {
      code: 'NENBDAY-26-ABC12345',
      name: '誕生日クーポン',
      discountAmount: 500,
      validFrom: '2026-09-02T11:00:00+09:00',
      validTo: '2026-10-03T11:00:00+09:00',
    }, fetcher as typeof fetch)).resolves.toBeUndefined();
  });
});
