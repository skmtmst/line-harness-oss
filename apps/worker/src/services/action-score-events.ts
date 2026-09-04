import { applyPublishedActionScoreRules } from '@line-crm/db';
import type { ActionScoreApplication } from '@line-crm/db';
import { dispatchAutomationEventWithLogging } from './automation-triggers.js';

const BAND_RANK = { low: 0, normal: 1, high: 2 } as const;

function crossedBands(application: ActionScoreApplication): Array<'normal' | 'high'> {
  const before = BAND_RANK[application.bandBefore];
  const after = BAND_RANK[application.bandAfter];
  if (before === after) return [];
  const lower = Math.min(before, after);
  const upper = Math.max(before, after);
  return (['normal', 'high'] as const).filter((band) => {
    const boundary = BAND_RANK[band];
    return boundary > lower && boundary <= upper;
  });
}

/**
 * V6行動スコアへ元イベントを1回だけ反映し、層をまたいだ瞬間だけ
 * オートメーションへ別イベントを渡す。元イベントIDが無い呼び出しは
 * 推測せず、DBヘルパーが未設定扱いとして止める。
 */
export async function applyActionScoreEvent(
  db: D1Database,
  input: {
    lineAccountId: string;
    friendId: string;
    eventType: string;
    source: string;
    sourceEventId: string;
    subjectKey?: string | null;
    occurredAt: string;
    lineAccessToken?: string;
  },
) {
  const result = await applyPublishedActionScoreRules(db, input);
  await dispatchActionScoreApplications(db, {
    lineAccountId: input.lineAccountId,
    friendId: input.friendId,
    applications: result.applications,
    lineAccessToken: input.lineAccessToken,
  });
  return result;
}

export async function dispatchActionScoreApplications(
  db: D1Database,
  input: {
    lineAccountId: string;
    friendId: string;
    applications: ActionScoreApplication[];
    lineAccessToken?: string;
  },
): Promise<void> {
  for (const application of input.applications) {
    if (application.replayed || application.bandBefore === application.bandAfter) continue;
    const eventData = {
      ruleId: application.ruleId,
      ruleVersionId: application.ruleVersionId,
      scoreBefore: application.scoreBefore,
      currentScore: application.scoreAfter,
      previousBand: application.bandBefore,
      currentBand: application.bandAfter,
    };
    await dispatchAutomationEventWithLogging(db, {
      lineAccountId: input.lineAccountId,
      eventType: 'score_band_changed',
      sourceEventId: `score:${application.historyId}:band`,
      friendId: input.friendId,
      eventData,
      lineAccessToken: input.lineAccessToken,
    });
    for (const band of crossedBands(application)) {
      await dispatchAutomationEventWithLogging(db, {
        lineAccountId: input.lineAccountId,
        eventType: 'score_threshold_crossed',
        sourceEventId: `score:${application.historyId}:threshold:${band}`,
        friendId: input.friendId,
        eventData: { ...eventData, thresholdBand: band },
        lineAccessToken: input.lineAccessToken,
      });
    }
  }
}
