import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SCHEDULED_CRONS } from './services/scheduled-job-isolation.js';

const workerSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

function sourceBetween(start: string, end: string): string {
  const startIndex = workerSource.indexOf(start);
  const endIndex = workerSource.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return workerSource.slice(startIndex, endIndex);
}

describe('Cron Trigger設定', () => {
  it('Workerが判定するCron式がwrangler.tomlにすべて登録されている', () => {
    const wranglerConfig = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    const configuredCronList = wranglerConfig.match(/^crons\s*=\s*(\[[^\n]+\])/m)?.[1];

    expect(configuredCronList).toBeDefined();

    const configuredCrons = new Set<string>(JSON.parse(configuredCronList ?? '[]'));
    expect(workerSource).toContain('scheduledLane(event.cron)');
    expect(configuredCrons).toEqual(new Set(Object.values(SCHEDULED_CRONS)));
  });

  it('通知と重い処理を、それぞれ決めたCronレーンに残す', () => {
    const frequentHeavy = sourceBetween(
      'async function runFrequentHeavyJobs(',
      'async function runSixHourlyHeavyJobs(',
    );
    const sixHourlyHeavy = sourceBetween(
      'async function runSixHourlyHeavyJobs(',
      '// Scheduled handler for cron triggers',
    );
    const delivery = sourceBetween('async function scheduled(', '\nexport default');

    const frequentHeavyCalls = [
      'processDueFriendBulkRuns',
      'processPendingAnalyticsCrossRuns',
      'processPendingMileageEvents',
      'processPendingAnalyticsUrlExposures',
      'refreshRecentAnalyticsProjections',
      'checkAccountHealth',
      'processInsightFetch',
      'processPendingNenRichMenuJobs',
      'syncXServerSupportMailbox',
      'processFriendFieldReminders',
    ];
    const sixHourlyHeavyCalls = [
      'refreshAllNenTags',
      'purgeExpiredAnalyticsReadData',
      'recordFriendSnapshot',
      'scanMediaUsage',
      'enqueueFollowingMileageMilestones',
      'runExpirer',
      'runEventBookingExpirer',
      'deleteExpiredRestaurantRawEmails',
    ];
    const deliveryCalls = [
      'processScheduledAutomationTriggers',
      'processDueAutomationRuns',
      'processDueReminders',
      'processDueEventReminders',
      'processDueMeetConsultationReminders',
      'processWebinarReminders',
      'processNenDeliveries',
      'applyDueCommonVarSchedules',
      'processWebinarFollowups',
      'processStepDeliveries',
      'processScheduledBroadcasts',
      'processReminderDeliveries',
      'processQueuedBroadcasts',
    ];

    for (const call of frequentHeavyCalls) expect(frequentHeavy).toContain(call);
    for (const call of sixHourlyHeavyCalls) expect(sixHourlyHeavy).toContain(call);
    for (const call of deliveryCalls) expect(delivery).toContain(call);
    for (const call of [...frequentHeavyCalls, ...sixHourlyHeavyCalls]) {
      expect(delivery).not.toContain(call);
    }
  });
});
