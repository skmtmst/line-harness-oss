import { describe, expect, it } from 'vitest';

import {
  analyzeLegacyAutomations,
  assessLegacyAutomation,
  type LegacyAutomationMigrationRow,
} from '../src/automation-migration';

function legacyRow(
  overrides: Partial<LegacyAutomationMigrationRow> = {},
): LegacyAutomationMigrationRow {
  return {
    id: 'automation-1',
    name: '来店後フォロー',
    line_account_id: 'account-1',
    event_type: 'friend_add',
    conditions: '{}',
    actions: JSON.stringify([{ type: 'add_tag', params: { tagId: 'tag-1' } }]),
    is_active: 1,
    priority: 0,
    ...overrides,
  };
}

describe('V6オートメーション移行dry-run', () => {
  it('認識できる所属・きっかけ・条件・処理だけを自動変換にする', () => {
    expect(assessLegacyAutomation(legacyRow())).toMatchObject({
      decision: 'auto_convert',
      reasons: [],
      wouldRemainActive: true,
    });
  });

  it('所属不明や壊れたJSONは除外し、有効状態を引き継がない', () => {
    expect(assessLegacyAutomation(legacyRow({
      line_account_id: null,
      conditions: '{broken',
    }))).toMatchObject({
      decision: 'excluded',
      reasons: ['line_account_id_missing', 'conditions_json_invalid'],
      wouldRemainActive: false,
    });
  });

  it('未知の処理とWebhookは成功扱いにせず要確認にする', () => {
    const result = assessLegacyAutomation(legacyRow({
      actions: JSON.stringify([
        { type: 'send_webhook', params: { url: 'https://example.com/hook' } },
        { type: 'unknown_action', params: {} },
      ]),
    }));

    expect(result.decision).toBe('needs_review');
    expect(result.reasons).toEqual([
      'action_1_webhook_requires_secret_and_ssrf_review',
      'action_2_unknown_type:unknown_action',
    ]);
  });

  it('必須参照がない処理を要確認にする', () => {
    expect(assessLegacyAutomation(legacyRow({
      actions: JSON.stringify([{ type: 'start_scenario', params: {} }]),
    }))).toMatchObject({
      decision: 'needs_review',
      reasons: ['action_1_missing_scenario_id'],
    });
  });

  it('3分類を理由付きで集計する', () => {
    const report = analyzeLegacyAutomations([
      legacyRow(),
      legacyRow({ id: 'review', event_type: 'mystery' }),
      legacyRow({ id: 'excluded', line_account_id: null }),
    ]);

    expect(report).toMatchObject({
      total: 3,
      autoConvert: 1,
      needsReview: 1,
      excluded: 1,
    });
    expect(report.assessments.map((item) => item.id)).toEqual([
      'automation-1',
      'review',
      'excluded',
    ]);
  });
});
