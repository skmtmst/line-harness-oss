import { describe, expect, it } from 'vitest';
import {
  classifyExternalDeliveryError,
  EXTERNAL_DELIVERY_MAX_ATTEMPTS,
  EXTERNAL_DELIVERY_RETRY_AFTER_MAX_MINUTES,
  externalDeliveryRetryAt,
} from './external-delivery-retry.js';

/** line-proxy-send と同じ形の 429 エラー。 */
function rateLimited(retryAfter?: string | null) {
  const error = new Error('LINE Harness proxy error: 429 Too Many Requests — ') as Error & {
    status: number;
    retryAfter: string | null;
  };
  error.status = 429;
  error.retryAfter = retryAfter ?? null;
  return error;
}

describe('429 の次回実行（N-374）', () => {
  it('上限は30分', () => {
    expect(EXTERNAL_DELIVERY_RETRY_AFTER_MAX_MINUTES).toBe(30);
  });

  it('秒数形式の Retry-After どおりに決める', () => {
    const now = new Date('2026-09-08T12:00:00.000Z');
    const at = externalDeliveryRetryAt(rateLimited('45'), 1, now, true);
    expect(at?.getTime()).toBe(now.getTime() + 45_000);
  });

  it('HTTP-date 形式の Retry-After どおりに決める', () => {
    const now = new Date('2026-09-08T12:00:00.000Z');
    const at = externalDeliveryRetryAt(
      rateLimited(new Date(now.getTime() + 90_000).toUTCString()),
      1,
      now,
      true,
    );
    // 日付の文字起こしで秒未満が落ちる分だけ前にずれる。
    expect(at!.getTime()).toBeGreaterThan(now.getTime() + 89_000);
    expect(at!.getTime()).toBeLessThanOrEqual(now.getTime() + 90_000);
  });

  it('再試行台帳へ渡す60秒は保ち、3600秒は30分へクランプする', () => {
    const now = new Date('2026-09-08T12:00:00.000Z');
    expect(externalDeliveryRetryAt(rateLimited('60'), 1, now, true)?.getTime())
      .toBe(now.getTime() + 60_000);
    // 3600秒（60分）は上限30分を超えるため、安全上限を次回時刻にする。
    expect(externalDeliveryRetryAt(rateLimited('3600'), 1, now, true)?.getTime())
      .toBe(now.getTime() + 30 * 60_000);
    // 2時間後の日付も同じく30分上限になる。
    expect(
      externalDeliveryRetryAt(
        rateLimited(new Date(now.getTime() + 2 * 3_600_000).toUTCString()),
        1,
        now,
        true,
      )?.getTime(),
    ).toBe(now.getTime() + 30 * 60_000);
  });

  it('読めない・過去の指定は既定の間隔へ丸める', () => {
    const now = new Date('2026-09-08T12:00:00.000Z');
    expect(externalDeliveryRetryAt(rateLimited('soon'), 1, now, true)?.getTime())
      .toBe(now.getTime() + 60_000);
    expect(externalDeliveryRetryAt(rateLimited('-5'), 1, now, true)?.getTime())
      .toBe(now.getTime() + 60_000);
    expect(
      externalDeliveryRetryAt(
        rateLimited(new Date(now.getTime() - 60_000).toUTCString()),
        1,
        now,
        true,
      )?.getTime(),
    ).toBe(now.getTime() + 60_000);
  });

  it('指定がなければ従来どおり1分・5分・30分', () => {
    const now = new Date('2026-09-08T12:00:00.000Z');
    expect(externalDeliveryRetryAt(rateLimited(), 1, now, true)?.getTime())
      .toBe(now.getTime() + 60_000);
    expect(externalDeliveryRetryAt(rateLimited(), 2, now, true)?.getTime())
      .toBe(now.getTime() + 5 * 60_000);
    expect(externalDeliveryRetryAt(rateLimited(), 3, now, true)?.getTime())
      .toBe(now.getTime() + 30 * 60_000);
    // 上限（初回含め4回）を超えたら止める。
    expect(externalDeliveryRetryAt(rateLimited(), EXTERNAL_DELIVERY_MAX_ATTEMPTS, now, true))
      .toBeNull();
  });

  it('再試行できない失敗は次回を作らない', () => {
    const now = new Date('2026-09-08T12:00:00.000Z');
    expect(externalDeliveryRetryAt(rateLimited('45'), 1, now, false)).toBeNull();
    const rejected = new Error('LINE Harness proxy error: 400 Bad Request — ') as Error & {
      status: number;
    };
    rejected.status = 400;
    expect(classifyExternalDeliveryError(rejected).retryable).toBe(false);
    expect(externalDeliveryRetryAt(rejected, 1, now, false)).toBeNull();
  });
});
