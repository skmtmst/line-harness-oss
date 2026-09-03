import { describe, expect, test } from 'vitest';

import { nextDeliveryRetryAt } from './delivery-retry-policy.js';

describe('nextDeliveryRetryAt', () => {
  test('共通基盤どおり1分・5分・30分後だけを返す', () => {
    const now = new Date('2026-09-04T00:00:00.000Z');

    expect(nextDeliveryRetryAt(now, 1)?.toISOString()).toBe('2026-09-04T00:01:00.000Z');
    expect(nextDeliveryRetryAt(now, 2)?.toISOString()).toBe('2026-09-04T00:05:00.000Z');
    expect(nextDeliveryRetryAt(now, 3)?.toISOString()).toBe('2026-09-04T00:30:00.000Z');
    expect(nextDeliveryRetryAt(now, 4)).toBeNull();
  });
});
