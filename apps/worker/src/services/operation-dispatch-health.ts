import {
  finishOperationDispatcherHeartbeat,
  listOperationDispatcherHeartbeats,
  startOperationDispatcherHeartbeat,
  type OperationHealthResultInput,
  type OperationHealthStatus,
} from '@line-crm/db';

import { DELIVERY_DISPATCH_JOB_NAMES } from './feature-enforcement.js';

const WARNING_MINUTES = 10;
const DANGER_MINUTES = 30;

type DispatchState = 'queued' | 'sending' | 'retrying' | 'dead';

type CrosswalkSource = {
  readonly table: string;
  readonly requiredColumns: readonly string[];
};

type CrosswalkQuery = {
  readonly sql: string;
  readonly accountBindingCount: number;
};

type DispatchJobCrosswalk = {
  readonly jobName: string;
  readonly sources: readonly CrosswalkSource[];
  readonly queries: readonly CrosswalkQuery[];
};

const query = (sql: string, accountBindingCount = 1): CrosswalkQuery => ({
  sql,
  accountBindingCount,
});

/**
 * 現行delivery dispatcherと、その永続状態を結ぶ機械照合用crosswalk。
 *
 * dispatcher名はFEATURE_JOB_MANIFESTと完全一致させる。永続状態を持たない
 * stateは推測で補わず0件とし、実在する表・列だけを列挙する。
 */
export const OPERATION_DISPATCH_JOB_CROSSWALK: readonly DispatchJobCrosswalk[] = [
  {
    jobName: 'automation deliveries',
    sources: [{
      table: 'automation_runs',
      requiredColumns: ['line_account_id', 'status', 'resume_at', 'started_at', 'created_at'],
    }],
    queries: [query(`
      SELECT CASE status
               WHEN 'queued' THEN 'queued'
               WHEN 'running' THEN 'sending'
               WHEN 'waiting' THEN 'retrying'
               WHEN 'failed' THEN 'dead'
             END AS state,
             COUNT(*) AS item_count,
             MIN(CASE status
                   WHEN 'waiting' THEN COALESCE(resume_at, created_at)
                   WHEN 'running' THEN COALESCE(started_at, created_at)
                   ELSE created_at
                 END) AS oldest_at
        FROM automation_runs
       WHERE line_account_id = ? AND status IN ('queued', 'running', 'waiting', 'failed')
       GROUP BY state`)],
  },
  {
    jobName: 'booking reminders',
    sources: [
      { table: 'booking_reminders', requiredColumns: ['booking_id', 'status', 'scheduled_at'] },
      { table: 'bookings', requiredColumns: ['id', 'line_account_id'] },
    ],
    queries: [query(`
      SELECT CASE br.status
               WHEN 'pending' THEN 'queued'
               WHEN 'failed' THEN 'retrying'
               WHEN 'failed_permanent' THEN 'dead'
             END AS state,
             COUNT(*) AS item_count, MIN(br.scheduled_at) AS oldest_at
        FROM booking_reminders br
        JOIN bookings b ON b.id = br.booking_id
       WHERE b.line_account_id = ? AND br.status IN ('pending', 'failed', 'failed_permanent')
       GROUP BY state`)],
  },
  {
    jobName: 'event reminders',
    sources: [
      { table: 'event_booking_reminders', requiredColumns: ['booking_id', 'status', 'scheduled_at'] },
      { table: 'event_bookings', requiredColumns: ['id', 'line_account_id'] },
    ],
    queries: [query(`
      SELECT CASE ebr.status
               WHEN 'pending' THEN 'queued'
               WHEN 'failed' THEN 'retrying'
               WHEN 'failed_permanent' THEN 'dead'
             END AS state,
             COUNT(*) AS item_count, MIN(ebr.scheduled_at) AS oldest_at
        FROM event_booking_reminders ebr
        JOIN event_bookings eb ON eb.id = ebr.booking_id
       WHERE eb.line_account_id = ? AND ebr.status IN ('pending', 'failed', 'failed_permanent')
       GROUP BY state`)],
  },
  {
    jobName: 'meet consultation reminders',
    sources: [
      {
        table: 'meet_consultation_reminders',
        requiredColumns: ['consultation_id', 'status', 'retry_count', 'scheduled_at'],
      },
      { table: 'meet_consultations', requiredColumns: ['id', 'friend_id'] },
      { table: 'friends', requiredColumns: ['id', 'line_account_id'] },
    ],
    queries: [query(`
      SELECT CASE
               WHEN mcr.status = 'pending' THEN 'queued'
               WHEN mcr.status = 'failed' AND mcr.retry_count < 3 THEN 'retrying'
               WHEN mcr.status = 'failed' THEN 'dead'
             END AS state,
             COUNT(*) AS item_count, MIN(mcr.scheduled_at) AS oldest_at
        FROM meet_consultation_reminders mcr
        JOIN meet_consultations mc ON mc.id = mcr.consultation_id
        JOIN friends f ON f.id = mc.friend_id
       WHERE f.line_account_id = ? AND mcr.status IN ('pending', 'failed')
       GROUP BY state`)],
  },
  {
    jobName: 'webinar reminders',
    sources: [
      {
        table: 'webinar_registrations',
        requiredColumns: ['webinar_id', 'status', 'notified_at', 'session_start_at'],
      },
      { table: 'webinars', requiredColumns: ['id', 'account_id', 'status'] },
      { table: 'webinar_notification_settings', requiredColumns: ['webinar_id'] },
    ],
    queries: [query(`
      SELECT 'queued' AS state, COUNT(*) AS item_count,
             MIN(strftime('%Y-%m-%dT%H:%M:%fZ', wr.session_start_at, 'unixepoch')) AS oldest_at
        FROM webinar_registrations wr
        JOIN webinars w ON w.id = wr.webinar_id
       WHERE w.account_id = ? AND w.status = 'active'
         AND wr.status = 'active' AND wr.notified_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM webinar_notification_settings wns WHERE wns.webinar_id = w.id
         )
       HAVING COUNT(*) > 0`)],
  },
  {
    jobName: 'webinar notifications',
    sources: [
      {
        table: 'webinar_notification_jobs',
        requiredColumns: ['webinar_id', 'status', 'scheduled_at', 'next_retry_at', 'created_at'],
      },
      { table: 'webinars', requiredColumns: ['id', 'account_id'] },
    ],
    queries: [query(`
      SELECT CASE wnj.status
               WHEN 'queued' THEN 'queued'
               WHEN 'claimed' THEN 'sending'
               WHEN 'retry_wait' THEN 'retrying'
               WHEN 'permanent_failed' THEN 'dead'
             END AS state,
             COUNT(*) AS item_count,
             MIN(CASE WHEN wnj.status = 'retry_wait'
                      THEN strftime('%Y-%m-%dT%H:%M:%fZ', COALESCE(wnj.next_retry_at, wnj.scheduled_at), 'unixepoch')
                      ELSE strftime('%Y-%m-%dT%H:%M:%fZ', wnj.scheduled_at, 'unixepoch') END) AS oldest_at
        FROM webinar_notification_jobs wnj
        JOIN webinars w ON w.id = wnj.webinar_id
       WHERE w.account_id = ?
         AND wnj.status IN ('queued', 'claimed', 'retry_wait', 'permanent_failed')
       GROUP BY state`)],
  },
  {
    jobName: 'webinar followups',
    sources: [
      { table: 'webinar_followups', requiredColumns: ['webinar_id', 'status', 'created_at'] },
      { table: 'webinar_journey_followups', requiredColumns: ['webinar_id', 'status', 'created_at'] },
      { table: 'webinars', requiredColumns: ['id', 'account_id'] },
    ],
    queries: [
      query(`
        SELECT CASE wf.status WHEN 'pending' THEN 'queued' WHEN 'failed' THEN 'retrying' END AS state,
               COUNT(*) AS item_count, MIN(wf.created_at) AS oldest_at
          FROM webinar_followups wf
          JOIN webinars w ON w.id = wf.webinar_id
         WHERE w.account_id = ? AND wf.status IN ('pending', 'failed')
         GROUP BY state`),
      query(`
        SELECT CASE wjf.status WHEN 'pending' THEN 'queued' WHEN 'failed' THEN 'retrying' END AS state,
               COUNT(*) AS item_count, MIN(wjf.created_at) AS oldest_at
          FROM webinar_journey_followups wjf
          JOIN webinars w ON w.id = wjf.webinar_id
         WHERE w.account_id = ? AND wjf.status IN ('pending', 'failed')
         GROUP BY state`),
    ],
  },
  {
    jobName: 'NEN campaign deliveries',
    sources: [{
      table: 'nen_delivery_jobs',
      requiredColumns: ['line_account_id', 'status', 'attempts', 'scheduled_at', 'updated_at'],
    }],
    queries: [query(`
      SELECT CASE
               WHEN status = 'pending' THEN 'queued'
               WHEN status = 'processing' THEN 'sending'
               WHEN status = 'failed' AND attempts < 5 THEN 'retrying'
               WHEN status = 'failed' THEN 'dead'
             END AS state,
             COUNT(*) AS item_count,
             MIN(CASE WHEN status IN ('processing', 'failed') THEN updated_at ELSE scheduled_at END) AS oldest_at
        FROM nen_delivery_jobs
       WHERE line_account_id = ? AND status IN ('pending', 'processing', 'failed')
       GROUP BY state`)],
  },
  {
    jobName: 'common variable schedules',
    sources: [
      { table: 'common_var_schedules', requiredColumns: ['var_id', 'effective_from', 'applied_at'] },
      { table: 'common_vars', requiredColumns: ['id', 'line_account_id'] },
    ],
    queries: [query(`
      SELECT 'queued' AS state, COUNT(*) AS item_count, MIN(cvs.effective_from) AS oldest_at
        FROM common_var_schedules cvs
        JOIN common_vars cv ON cv.id = cvs.var_id
       WHERE cv.line_account_id = ? AND cvs.applied_at IS NULL
       HAVING COUNT(*) > 0`)],
  },
  {
    jobName: 'scenario deliveries',
    sources: [
      {
        table: 'friend_scenarios',
        requiredColumns: ['scenario_id', 'status', 'next_delivery_at', 'updated_at'],
      },
      { table: 'scenarios', requiredColumns: ['id', 'line_account_id'] },
    ],
    queries: [query(`
      SELECT CASE fs.status WHEN 'active' THEN 'queued' WHEN 'delivering' THEN 'sending' END AS state,
             COUNT(*) AS item_count,
             MIN(CASE WHEN fs.status = 'delivering' THEN fs.updated_at ELSE fs.next_delivery_at END) AS oldest_at
        FROM friend_scenarios fs
        JOIN scenarios s ON s.id = fs.scenario_id
       WHERE s.line_account_id = ?
         AND (fs.status = 'delivering' OR (fs.status = 'active' AND fs.next_delivery_at IS NOT NULL))
       GROUP BY state`)],
  },
  {
    jobName: 'broadcast deliveries',
    sources: [{
      table: 'broadcasts',
      requiredColumns: [
        'line_account_id', 'account_ids', 'status', 'scheduled_at', 'batch_lock_at', 'created_at',
      ],
    }],
    queries: [query(`
      SELECT CASE status WHEN 'scheduled' THEN 'queued' WHEN 'sending' THEN 'sending' END AS state,
             COUNT(*) AS item_count,
             MIN(CASE WHEN status = 'sending' THEN COALESCE(batch_lock_at, created_at)
                      ELSE COALESCE(scheduled_at, created_at) END) AS oldest_at
        FROM broadcasts b
       WHERE (b.line_account_id = ? OR EXISTS (
                SELECT 1 FROM json_each(COALESCE(b.account_ids, '[]')) WHERE value = ?
              ))
         AND b.status IN ('scheduled', 'sending')
       GROUP BY state`, 2)],
  },
  {
    jobName: 'reminder deliveries',
    sources: [{
      table: 'reminder_delivery_runs',
      requiredColumns: [
        'line_account_id', 'status', 'scheduled_at', 'next_retry_at', 'started_at', 'created_at',
      ],
    }],
    queries: [query(`
      SELECT CASE status
               WHEN 'queued' THEN 'queued'
               WHEN 'claimed' THEN 'sending'
               WHEN 'retry_wait' THEN 'retrying'
               WHEN 'permanent_failed' THEN 'dead'
             END AS state,
             COUNT(*) AS item_count,
             MIN(CASE status
                   WHEN 'claimed' THEN COALESCE(started_at, created_at)
                   WHEN 'retry_wait' THEN COALESCE(next_retry_at, scheduled_at, created_at)
                   ELSE COALESCE(scheduled_at, created_at)
                 END) AS oldest_at
        FROM reminder_delivery_runs
       WHERE line_account_id = ?
         AND status IN ('queued', 'claimed', 'retry_wait', 'permanent_failed')
       GROUP BY state`)],
  },
] as const;

type DispatchRow = {
  job_name: string;
  state: DispatchState;
  item_count: number;
  oldest_at: string | null;
};

type DispatchCounts = Record<DispatchState, number>;

function emptyCounts(): DispatchCounts {
  return { queued: 0, sending: 0, retrying: 0, dead: 0 };
}

function elapsedMinutes(observedAt: string, timestamp: string | null): number {
  const observedMs = Date.parse(observedAt);
  const timestampMs = timestamp ? Date.parse(timestamp) : Number.NaN;
  return Number.isFinite(observedMs) && Number.isFinite(timestampMs)
    ? Math.max(0, Math.floor((observedMs - timestampMs) / 60_000))
    : 0;
}

function olderTimestamp(current: string | null, candidate: string | null): string | null {
  if (!candidate) return current;
  if (!current) return candidate;
  const currentMs = Date.parse(current);
  const candidateMs = Date.parse(candidate);
  if (!Number.isFinite(candidateMs)) return current;
  return !Number.isFinite(currentMs) || candidateMs < currentMs ? candidate : current;
}

function healthStatus(input: {
  counts: DispatchCounts;
  delayMinutes: number;
  heartbeatMinutes: number;
  heartbeatStatus: 'running' | 'succeeded' | 'failed' | null;
}): OperationHealthStatus {
  if (
    input.heartbeatStatus === null
    || input.heartbeatStatus === 'failed'
    || input.counts.dead > 0
    || input.delayMinutes >= DANGER_MINUTES
    || input.heartbeatMinutes >= DANGER_MINUTES
  ) return 'danger';
  if (
    input.counts.retrying > 0
    || input.delayMinutes >= WARNING_MINUTES
    || input.heartbeatMinutes >= WARNING_MINUTES
  ) return 'warning';
  return 'normal';
}

export async function collectOperationDispatchHealth(
  db: D1Database,
  lineAccountId: string,
  observedAt: string,
): Promise<OperationHealthResultInput> {
  const manifestNames = [...DELIVERY_DISPATCH_JOB_NAMES];
  const crosswalkNames = OPERATION_DISPATCH_JOB_CROSSWALK.map(({ jobName }) => jobName);
  const manifestOnly = manifestNames.filter((name) => !crosswalkNames.includes(name));
  const crosswalkOnly = crosswalkNames.filter((name) => !manifestNames.includes(name));

  const queryParts: string[] = [];
  const queryBindings: string[] = [];
  for (const job of OPERATION_DISPATCH_JOB_CROSSWALK) {
    for (const sourceQuery of job.queries) {
      queryParts.push(`SELECT ? AS job_name, state, item_count, oldest_at FROM (${sourceQuery.sql})`);
      queryBindings.push(
        job.jobName,
        ...Array.from({ length: sourceQuery.accountBindingCount }, () => lineAccountId),
      );
    }
  }
  // accountごとの状態は1本のUNIONで取得し、dispatcher数ぶんのD1往復を発生させない。
  const [heartbeats, dispatchRows] = await Promise.all([
    listOperationDispatcherHeartbeats(db),
    db.prepare(queryParts.join('\nUNION ALL\n')).bind(...queryBindings).all<DispatchRow>(),
  ]);
  const knownNames = new Set(crosswalkNames);
  const unknownHeartbeatNames = heartbeats
    .map(({ jobName }) => jobName)
    .filter((name) => !knownNames.has(name));
  const unknownJobs = [...new Set([...manifestOnly, ...crosswalkOnly, ...unknownHeartbeatNames])].sort();
  const heartbeatByName = new Map(heartbeats.map((heartbeat) => [heartbeat.jobName, heartbeat]));

  let oldestAt: string | null = null;
  let pendingCount = 0;
  let deadCount = 0;
  let missingHeartbeatCount = 0;
  const dispatchers = [];

  const countsByJob = new Map<string, DispatchCounts>();
  const oldestByJob = new Map<string, string | null>();
  for (const job of OPERATION_DISPATCH_JOB_CROSSWALK) {
    countsByJob.set(job.jobName, emptyCounts());
    oldestByJob.set(job.jobName, null);
  }
  for (const row of dispatchRows.results ?? []) {
    const counts = countsByJob.get(row.job_name);
    if (!counts || !(row.state in counts)) {
      throw new Error(`unknown_dispatch_state:${row.job_name}:${row.state}`);
    }
    counts[row.state] += Number(row.item_count ?? 0);
    if (row.state !== 'dead') {
      oldestByJob.set(row.job_name, olderTimestamp(oldestByJob.get(row.job_name) ?? null, row.oldest_at));
    }
  }

  for (const job of OPERATION_DISPATCH_JOB_CROSSWALK) {
    const counts = countsByJob.get(job.jobName)!;
    const jobOldestAt = oldestByJob.get(job.jobName) ?? null;

    const heartbeat = heartbeatByName.get(job.jobName);
    if (!heartbeat) missingHeartbeatCount += 1;
    const heartbeatAt = heartbeat?.updatedAt ?? null;
    const delayMinutes = elapsedMinutes(observedAt, jobOldestAt);
    const heartbeatMinutes = elapsedMinutes(observedAt, heartbeatAt);
    const status = healthStatus({
      counts,
      delayMinutes,
      heartbeatMinutes,
      heartbeatStatus: heartbeat?.lastStatus ?? null,
    });
    pendingCount += counts.queued + counts.sending + counts.retrying;
    deadCount += counts.dead;
    oldestAt = olderTimestamp(oldestAt, jobOldestAt);
    dispatchers.push({
      jobName: job.jobName,
      status,
      states: counts,
      oldestAt: jobOldestAt,
      delayMinutes,
      heartbeatAt,
      heartbeatMinutes,
      heartbeatStatus: heartbeat?.lastStatus ?? null,
    });
  }

  const delayMinutes = elapsedMinutes(observedAt, oldestAt);
  const status: OperationHealthStatus = unknownJobs.length > 0
    ? 'unknown'
    : dispatchers.some((dispatcher) => dispatcher.status === 'danger')
      ? 'danger'
      : dispatchers.some((dispatcher) => dispatcher.status === 'warning')
        ? 'warning'
        : 'normal';

  return {
    checkKey: 'dispatch_jobs',
    status,
    summary: status === 'normal'
      ? '配信処理の滞留はありません'
      : status === 'unknown'
        ? '配信処理の確認に失敗しました'
        : '配信処理に遅延または失敗があります',
    source: 'delivery_dispatcher_crosswalk',
    observedAt,
    value: {
      pendingCount,
      deadCount,
      oldestAt,
      delayMinutes,
      missingHeartbeatCount,
      unknownJobs,
      dispatchers,
    },
    threshold: { warningMinutes: WARNING_MINUTES, dangerMinutes: DANGER_MINUTES },
  };
}

async function safeHeartbeat(write: () => Promise<void>, jobName: string, phase: string): Promise<void> {
  try {
    await write();
  } catch (error) {
    console.error(JSON.stringify({
      event: 'operation_dispatcher_heartbeat_write_failed',
      job: jobName,
      phase,
      error: error instanceof Error ? error.name : 'UnknownError',
    }));
  }
}

/** heartbeatの保存失敗で既存dispatcherを止めず、dispatcher自身の例外は維持する。 */
export async function observeOperationDispatcher<T>(
  db: D1Database,
  jobName: string,
  run: () => Promise<T>,
  observedAt?: string,
): Promise<T> {
  const startedAt = observedAt ?? new Date().toISOString();
  await safeHeartbeat(
    () => startOperationDispatcherHeartbeat(db, jobName, startedAt),
    jobName,
    'started',
  );
  try {
    const output = await run();
    await safeHeartbeat(
      () => finishOperationDispatcherHeartbeat(
        db,
        jobName,
        'succeeded',
        observedAt ?? new Date().toISOString(),
        startedAt,
      ),
      jobName,
      'succeeded',
    );
    return output;
  } catch (error) {
    await safeHeartbeat(
      () => finishOperationDispatcherHeartbeat(
        db,
        jobName,
        'failed',
        observedAt ?? new Date().toISOString(),
        startedAt,
      ),
      jobName,
      'failed',
    );
    throw error;
  }
}
