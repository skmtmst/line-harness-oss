export type ScheduledJob = {
  name: string;
  run: () => Promise<void>;
};

export type ScheduledJobFailure = {
  name: string;
  reason: unknown;
};

export const SCHEDULED_CRONS = {
  delivery: '*/5 * * * *',
  frequentHeavy: '1-56/5 * * * *',
  sixHourlyHeavy: '0 */6 * * *',
} as const;

export type ScheduledLane = keyof typeof SCHEDULED_CRONS | 'ignored';

export function scheduledLane(cron: string): ScheduledLane {
  const matched = Object.entries(SCHEDULED_CRONS).find(([, expression]) => expression === cron);
  return (matched?.[0] as keyof typeof SCHEDULED_CRONS | undefined) ?? 'ignored';
}

/** 同じcron内の処理を独立して走らせ、1件の失敗で残りを止めない。 */
export async function runIsolatedScheduledJobs(
  jobs: ScheduledJob[],
  onFailure: (failure: ScheduledJobFailure) => void = ({ name, reason }) => {
    console.error(`${name} error:`, reason);
  },
): Promise<{ succeeded: number; failed: number }> {
  const results = await Promise.allSettled(jobs.map((job) => job.run()));
  let failed = 0;
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      failed += 1;
      onFailure({ name: jobs[index]!.name, reason: result.reason });
    }
  });
  return { succeeded: results.length - failed, failed };
}
