import { describe, expect, it } from 'vitest';

import {
  analyzeLegacyFunnelDefinitions,
  type LegacyFunnelDefinitionRow,
} from '../src/analytics-funnel-migration.js';

function row(overrides: Partial<LegacyFunnelDefinitionRow> = {}): LegacyFunnelDefinitionRow {
  return {
    funnel_id: 'funnel-1', line_account_id: 'account-a', segment_json: null,
    window_days: 30, step_id: 'step-1', step_order: 1, label: '追加',
    kind: 'friend_add', match_json: '{}', reference_exists: 1,
    ...overrides,
  };
}

describe('現行ファネル移行dry-runの判定', () => {
  it('変換可・要確認・除外の理由を分ける', () => {
    const report = analyzeLegacyFunnelDefinitions([
      row(),
      row({ step_id: 'step-2', step_order: 2, label: '購入', kind: 'purchase', match_json: '{}' }),
      row({ funnel_id: 'broken', step_id: 'b1', reference_exists: 0 }),
      row({ funnel_id: 'broken', step_id: 'b2', step_order: 2, reference_exists: 1 }),
      row({ funnel_id: 'orphan', line_account_id: null, step_id: 'o1' }),
      row({ funnel_id: 'orphan', line_account_id: null, step_id: 'o2', step_order: 2 }),
    ]);
    expect(report).toMatchObject({ total: 3, autoConvert: 1, needsReview: 1, excluded: 1 });
    expect(report.assessments.find((item) => item.funnelId === 'broken')?.reasons)
      .toContain('step_reference_missing');
    expect(report.assessments.find((item) => item.funnelId === 'orphan')?.reasons)
      .toContain('line_account_id_missing');
  });

  it('未知の段と旧形式の条件を自動変換しない', () => {
    const report = analyzeLegacyFunnelDefinitions([
      row({ funnel_id: 'legacy', segment_json: '{"old":true}', kind: 'fortune' }),
      row({ funnel_id: 'legacy', segment_json: '{"old":true}', step_id: 'l2', step_order: 2 }),
    ]);
    expect(report.needsReview).toBe(1);
    expect(report.assessments[0].reasons).toEqual(expect.arrayContaining([
      'analytics_funnel_step_kind_unknown:fortune',
      'segment_requires_manual_conversion',
    ]));
  });
});
