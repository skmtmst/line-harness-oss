import { describe, expect, it } from 'vitest';

import {
  analyzeLegacyAnalyticsSources,
  type LegacyAnalyticsSourceRow,
} from '../src/analytics-migration.js';

const direct: LegacyAnalyticsSourceRow = {
  source_kind: 'friend_add_events',
  source_id: 'event-1',
  line_account_id: 'account-a',
  account_resolution: 'direct',
  friend_id: 'friend-a',
  event_type: 'friend_add',
  occurred_at: '2026-08-26T00:00:00.000Z',
};

describe('分析履歴のdry-run判定', () => {
  it('アカウント・時刻・種類が確定した行だけを自動変換にする', () => {
    const report = analyzeLegacyAnalyticsSources([direct]);
    expect(report).toMatchObject({ total: 1, autoConvert: 1, needsReview: 0, excluded: 0 });
  });

  it('現在の友だちから推測した所属とタイムゾーンなし時刻は要確認にする', () => {
    const report = analyzeLegacyAnalyticsSources([{
      ...direct,
      source_kind: 'form_submissions',
      account_resolution: 'friend_current',
      occurred_at: '2026-08-26T09:00:00.000',
      event_type: 'form_submitted',
    }]);
    expect(report.assessments[0]).toMatchObject({
      decision: 'needs_review',
      reasons: [
        'line_account_inferred_from_current_friend',
        'occurred_at_timezone_missing',
      ],
    });
  });

  it('所属不明は通常集計へ入れず除外理由を返す', () => {
    const report = analyzeLegacyAnalyticsSources([{
      ...direct,
      line_account_id: null,
      account_resolution: 'missing',
    }]);
    expect(report.assessments[0]).toMatchObject({
      decision: 'excluded', reasons: ['line_account_id_missing'],
    });
  });

  it('重複候補と未知の種類を0件扱いにせず要確認にする', () => {
    const unknown = { ...direct, event_type: 'unknown_event' };
    const report = analyzeLegacyAnalyticsSources([unknown, unknown]);
    expect(report).toMatchObject({ total: 2, needsReview: 2, duplicateKeys: 1 });
    expect(report.assessments[0].reasons).toContain('event_type_unknown:unknown_event');
    expect(report.assessments[1].reasons).toContain('idempotency_key_duplicate');
  });
});
