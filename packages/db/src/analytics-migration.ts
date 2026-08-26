import { ANALYTICS_EVENT_TYPES } from './analytics-event-types.js';

export type AnalyticsMigrationDecision = 'auto_convert' | 'needs_review' | 'excluded';
export type AnalyticsAccountResolution = 'direct' | 'friend_current' | 'missing';

export interface LegacyAnalyticsSourceRow {
  source_kind: string;
  source_id: string;
  line_account_id: string | null;
  account_resolution: AnalyticsAccountResolution;
  friend_id: string | null;
  event_type: string;
  occurred_at: string | null;
}

export interface AnalyticsMigrationAssessment {
  sourceKind: string;
  sourceId: string;
  lineAccountId: string | null;
  decision: AnalyticsMigrationDecision;
  reasons: string[];
}

export interface AnalyticsMigrationReport {
  total: number;
  autoConvert: number;
  needsReview: number;
  excluded: number;
  duplicateKeys: number;
  assessments: AnalyticsMigrationAssessment[];
}

function hasExplicitTimeZone(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && /(Z|[+-]\d{2}:?\d{2})$/.test(value);
}

export function analyzeLegacyAnalyticsSources(
  rows: LegacyAnalyticsSourceRow[],
): AnalyticsMigrationReport {
  const seen = new Set<string>();
  let duplicateKeys = 0;
  const assessments = rows.map((row): AnalyticsMigrationAssessment => {
    const excluded: string[] = [];
    const review: string[] = [];
    const sourceKind = row.source_kind?.trim();
    const sourceId = row.source_id?.trim();
    if (!sourceKind) excluded.push('source_kind_missing');
    if (!sourceId) excluded.push('source_id_missing');
    if (!row.line_account_id?.trim() || row.account_resolution === 'missing') {
      excluded.push('line_account_id_missing');
    } else if (row.account_resolution === 'friend_current') {
      review.push('line_account_inferred_from_current_friend');
    }
    if (!row.occurred_at?.trim()) excluded.push('occurred_at_missing');
    else if (!hasExplicitTimeZone(row.occurred_at)) review.push('occurred_at_timezone_missing');
    if (!ANALYTICS_EVENT_TYPES.has(row.event_type)) {
      review.push(`event_type_unknown:${row.event_type}`);
    }

    const key = `${row.line_account_id ?? ''}\u0000${sourceKind}\u0000${sourceId}\u0000${row.event_type}`;
    if (seen.has(key)) {
      review.push('idempotency_key_duplicate');
      duplicateKeys += 1;
    } else {
      seen.add(key);
    }

    const decision: AnalyticsMigrationDecision = excluded.length > 0
      ? 'excluded'
      : review.length > 0
        ? 'needs_review'
        : 'auto_convert';
    return {
      sourceKind,
      sourceId,
      lineAccountId: row.line_account_id,
      decision,
      reasons: decision === 'excluded' ? excluded : review,
    };
  });
  return {
    total: assessments.length,
    autoConvert: assessments.filter((item) => item.decision === 'auto_convert').length,
    needsReview: assessments.filter((item) => item.decision === 'needs_review').length,
    excluded: assessments.filter((item) => item.decision === 'excluded').length,
    duplicateKeys,
    assessments,
  };
}
