const STEP_KINDS = new Set([
  'friend_add', 'tag', 'field', 'form', 'site_event', 'purchase',
  'link_click', 'conversion', 'message', 'booking', 'automation',
]);

function requiredMatch(kind: string, match: Record<string, unknown>): void {
  const requiredByKind: Record<string, string | undefined> = {
    tag: 'tagId', field: 'fieldId', form: 'formId', link_click: 'trackedLinkId',
    conversion: 'conversionPointId', automation: 'automationId',
  };
  const key = requiredByKind[kind];
  if (key && (typeof match[key] !== 'string' || !String(match[key]).trim())) {
    throw new Error(`analytics_funnel_${key}_required`);
  }
}

function validateLegacySteps(steps: Array<{ label: string | null; kind: string | null; match: unknown }>): void {
  if (steps.length < 2 || steps.length > 10) throw new Error('analytics_funnel_steps_must_be_2_to_10');
  for (const step of steps) {
    if (!step.label?.trim()) throw new Error('analytics_funnel_step_label_required');
    if (!step.kind || !STEP_KINDS.has(step.kind)) {
      throw new Error(`analytics_funnel_step_kind_unknown:${String(step.kind)}`);
    }
    if (!step.match || typeof step.match !== 'object' || Array.isArray(step.match)) {
      throw new Error('analytics_funnel_step_match_invalid');
    }
    requiredMatch(step.kind, step.match as Record<string, unknown>);
  }
}

function validateLegacySegment(raw: unknown): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid');
  const value = raw as Record<string, unknown>;
  if (value.kind === 'all') return;
  if (value.kind === 'tag' && typeof value.tagId === 'string' && value.tagId.trim()) return;
  if (value.kind === 'field' && typeof value.fieldId === 'string' && value.fieldId.trim()) return;
  throw new Error('invalid');
}

export interface LegacyFunnelDefinitionRow {
  funnel_id: string;
  line_account_id: string | null;
  segment_json: string | null;
  window_days: number;
  step_id: string | null;
  step_order: number | null;
  label: string | null;
  kind: string | null;
  match_json: string | null;
  reference_exists: number | null;
}

export interface LegacyFunnelAssessment {
  funnelId: string;
  lineAccountId: string | null;
  decision: 'auto_convert' | 'needs_review' | 'excluded';
  reasons: string[];
}

export interface LegacyFunnelMigrationReport {
  total: number;
  autoConvert: number;
  needsReview: number;
  excluded: number;
  assessments: LegacyFunnelAssessment[];
}

export function analyzeLegacyFunnelDefinitions(
  rows: LegacyFunnelDefinitionRow[],
): LegacyFunnelMigrationReport {
  const grouped = new Map<string, LegacyFunnelDefinitionRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.funnel_id) ?? [];
    list.push(row);
    grouped.set(row.funnel_id, list);
  }
  const assessments = [...grouped.entries()].map(([funnelId, group]): LegacyFunnelAssessment => {
    const head = group[0];
    const excluded: string[] = [];
    const review: string[] = [];
    if (!head.line_account_id?.trim()) excluded.push('line_account_id_missing');
    if (!Number.isInteger(head.window_days) || head.window_days < 1 || head.window_days > 365) {
      review.push('window_days_invalid');
    }
    const steps = group
      .filter((row) => row.step_id)
      .sort((a, b) => Number(a.step_order) - Number(b.step_order));
    if (steps.some((step, index) => step.step_order !== index + 1)) {
      review.push('step_order_has_gap_or_duplicate');
    }
    try {
      validateLegacySteps(steps.map((step) => ({
        label: step.label,
        kind: step.kind,
        match: JSON.parse(step.match_json ?? '{}') as unknown,
      })));
    } catch (error) {
      review.push(error instanceof Error ? error.message : 'steps_invalid');
    }
    if (steps.some((step) => step.reference_exists === 0)) review.push('step_reference_missing');
    if (head.segment_json) {
      try {
        validateLegacySegment(JSON.parse(head.segment_json) as unknown);
      } catch {
        review.push('segment_requires_manual_conversion');
      }
    }
    const reasons = excluded.length > 0 ? excluded : [...new Set(review)];
    return {
      funnelId,
      lineAccountId: head.line_account_id,
      decision: excluded.length > 0
        ? 'excluded'
        : review.length > 0
          ? 'needs_review'
          : 'auto_convert',
      reasons,
    };
  });
  return {
    total: assessments.length,
    autoConvert: assessments.filter((item) => item.decision === 'auto_convert').length,
    needsReview: assessments.filter((item) => item.decision === 'needs_review').length,
    excluded: assessments.filter((item) => item.decision === 'excluded').length,
    assessments,
  };
}
