import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  applyPublishedActionScoreRules: vi.fn(),
  dispatchAutomationEventWithLogging: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  applyPublishedActionScoreRules: mocks.applyPublishedActionScoreRules,
}));

vi.mock('./automation-triggers.js', () => ({
  dispatchAutomationEventWithLogging: mocks.dispatchAutomationEventWithLogging,
}));

const { dispatchActionScoreApplications } = await import('./action-score-events.js');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dispatchAutomationEventWithLogging.mockResolvedValue([]);
});

describe('行動スコアの帯変更イベント', () => {
  it('再実行済みと帯内の変更を除き、またいだ境界を一度ずつ通知する', async () => {
    await dispatchActionScoreApplications({} as D1Database, {
      lineAccountId: 'account-1',
      friendId: 'friend-1',
      lineAccessToken: 'line-token',
      applications: [
        {
          historyId: 'history-replayed',
          ruleId: 'rule-1',
          ruleVersionId: 'version-1',
          scoreBefore: 10,
          scoreAfter: 80,
          bandBefore: 'low',
          bandAfter: 'high',
          replayed: true,
        },
        {
          historyId: 'history-unchanged',
          ruleId: 'rule-2',
          ruleVersionId: 'version-1',
          scoreBefore: 10,
          scoreAfter: 20,
          bandBefore: 'low',
          bandAfter: 'low',
          replayed: false,
        },
        {
          historyId: 'history-crossing',
          ruleId: 'rule-3',
          ruleVersionId: 'version-1',
          scoreBefore: 10,
          scoreAfter: 80,
          bandBefore: 'low',
          bandAfter: 'high',
          replayed: false,
        },
      ] as never,
    });

    expect(mocks.dispatchAutomationEventWithLogging).toHaveBeenCalledTimes(3);
    expect(mocks.dispatchAutomationEventWithLogging).toHaveBeenNthCalledWith(1, {},
      expect.objectContaining({
        lineAccountId: 'account-1',
        friendId: 'friend-1',
        eventType: 'score_band_changed',
        sourceEventId: 'score:history-crossing:band',
        lineAccessToken: 'line-token',
      }));
    expect(mocks.dispatchAutomationEventWithLogging).toHaveBeenNthCalledWith(2, {},
      expect.objectContaining({
        eventType: 'score_threshold_crossed',
        sourceEventId: 'score:history-crossing:threshold:normal',
        eventData: expect.objectContaining({ thresholdBand: 'normal' }),
      }));
    expect(mocks.dispatchAutomationEventWithLogging).toHaveBeenNthCalledWith(3, {},
      expect.objectContaining({
        eventType: 'score_threshold_crossed',
        sourceEventId: 'score:history-crossing:threshold:high',
        eventData: expect.objectContaining({ thresholdBand: 'high' }),
      }));
  });
});
