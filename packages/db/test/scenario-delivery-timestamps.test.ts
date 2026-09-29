import { describe, expect, test } from 'vitest';

import {
  analyzeScenarioDeliveryTimestamps,
  normalizeScenarioDeliveryTimestamp,
} from '../src/scenario-delivery-timestamps.js';

describe('scenario delivery timestamp normalization', () => {
  test('converts Z and other offsets to the canonical JST representation', () => {
    expect(normalizeScenarioDeliveryTimestamp('2026-09-03T00:00:00.000Z')).toBe(
      '2026-09-03T09:00:00.000+09:00',
    );
    expect(normalizeScenarioDeliveryTimestamp('2026-09-03T09:00:00.000+09:00')).toBe(
      '2026-09-03T09:00:00.000+09:00',
    );
    expect(normalizeScenarioDeliveryTimestamp('not-a-date')).toBeNull();
    expect(normalizeScenarioDeliveryTimestamp('2026-09-03T09:00:00.000')).toBeNull();
  });

  test('dry-run counts canonical, normalizable, and invalid rows without changing input', () => {
    const rows = [
      { id: 'canonical', next_delivery_at: '2026-09-03T09:00:00.000+09:00' },
      { id: 'zulu', next_delivery_at: '2026-09-03T00:00:00.000Z' },
      { id: 'invalid', next_delivery_at: 'unknown' },
    ];

    expect(analyzeScenarioDeliveryTimestamps(rows)).toEqual({
      total: 3,
      canonical: 1,
      normalizable: 1,
      invalid: 1,
      invalidSamples: [rows[2]],
    });
    expect(rows[1].next_delivery_at).toBe('2026-09-03T00:00:00.000Z');
  });
});
