import { toJstString } from './utils.js';

export const SCENARIO_DELIVERY_BATCH_LIMIT = 40;

export interface ScenarioDeliveryTimestampRow {
  id: string;
  next_delivery_at: string;
}

export interface ScenarioDeliveryTimestampDryRun {
  total: number;
  canonical: number;
  normalizable: number;
  invalid: number;
  invalidSamples: ScenarioDeliveryTimestampRow[];
}

/**
 * Convert any parseable timestamp to the single format used by due-delivery
 * queries: YYYY-MM-DDTHH:mm:ss.sss+09:00.
 */
export function normalizeScenarioDeliveryTimestamp(value: string): string | null {
  // A timezone-less value is ambiguous and must be fixed by a person before
  // migration. Accepting it would make the result depend on the machine's TZ.
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return toJstString(parsed);
}

/** Read-only assessment used before applying the normalization migration. */
export function analyzeScenarioDeliveryTimestamps(
  rows: ScenarioDeliveryTimestampRow[],
): ScenarioDeliveryTimestampDryRun {
  let canonical = 0;
  let normalizable = 0;
  const invalidSamples: ScenarioDeliveryTimestampRow[] = [];

  for (const row of rows) {
    const normalized = normalizeScenarioDeliveryTimestamp(row.next_delivery_at);
    if (normalized === null) {
      if (invalidSamples.length < 100) invalidSamples.push(row);
    } else if (normalized === row.next_delivery_at) {
      canonical++;
    } else {
      normalizable++;
    }
  }

  return {
    total: rows.length,
    canonical,
    normalizable,
    invalid: rows.length - canonical - normalizable,
    invalidSamples,
  };
}
