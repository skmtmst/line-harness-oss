#!/usr/bin/env tsx

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  analyzeScenarioDeliveryTimestamps,
  buildFriendScenariosDueForDeliveryQuery,
  normalizeScenarioDeliveryTimestamp,
  SCENARIO_DELIVERY_BATCH_LIMIT,
  type ScenarioDeliveryTimestampRow,
} from '../packages/db/src/scenario-delivery-timestamps.js';

const CONFIG_PATH = 'apps/worker/wrangler.staging.toml';
const SESSION_TTL_MINUTES = 15;
const DEFAULT_TENANT_ID = '00000000-0000-4000-8000-000000000001';

type D1Envelope<T> = {
  success: boolean;
  result?: Array<{ success: boolean; results?: T[] }>;
};

type VerificationTarget = {
  accountId: string;
  databaseId: string;
  workerUrl: string;
};

type QueryD1 = <T>(sql: string, params?: unknown[]) => Promise<T[]>;

type ApiEnvelope<T> = { success: boolean; data: T };

type DueEnrollment = { id: string };

function required(name: string, value: string | undefined): string {
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function configValue(config: string, key: string): string {
  const match = config.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm'));
  if (!match?.[1]) throw new Error(`Missing ${key} in staging config`);
  return match[1];
}

export function readVerificationTarget(config: string): VerificationTarget {
  if (configValue(config, 'name') !== 'nen-line-stg') {
    throw new Error('Only the staging Worker is allowed');
  }
  if (configValue(config, 'database_name') !== 'nen-line-stg') {
    throw new Error('Only the staging D1 database is allowed');
  }
  if (/^\[triggers\]/m.test(config)) {
    throw new Error('The staging verification target must not have cron triggers');
  }

  const workerUrl = configValue(config, 'WORKER_PUBLIC_URL');
  const worker = new URL(workerUrl);
  if (worker.protocol !== 'https:' || !/^nen-line-stg\.[a-z0-9-]+\.workers\.dev$/.test(worker.hostname)) {
    throw new Error('Unexpected staging Worker URL');
  }
  return {
    accountId: configValue(config, 'account_id'),
    databaseId: configValue(config, 'database_id'),
    workerUrl: worker.origin,
  };
}

export function createD1Query(target: VerificationTarget, apiToken: string): QueryD1 {
  return async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(target.accountId)}/d1/database/${encodeURIComponent(target.databaseId)}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql, params }),
      },
    );
    const body = await response.json() as D1Envelope<T>;
    const result = body.result?.[0];
    if (!response.ok || !body.success || !result?.success) {
      throw new Error('Staging D1 query failed');
    }
    return result.results ?? [];
  };
}

async function notificationRequest<T>(
  target: VerificationTarget,
  sessionToken: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  if (!path.startsWith('/api/notifications/rules')) {
    throw new Error('The staging check may only call the notification-rules API');
  }
  const response = await fetch(`${target.workerUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer lh_session:${sessionToken}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  const body = await response.json() as ApiEnvelope<T>;
  if (!response.ok || !body.success) throw new Error('Staging notification API check failed');
  return body.data;
}

async function insertSyntheticDeliveryRows(
  query: QueryD1,
  runId: string,
  lineAccountId: string,
  now: string,
  dueAt: string,
): Promise<void> {
  await query(
    `INSERT INTO scenarios
       (id, name, description, trigger_type, is_active, delivery_mode, line_account_id, created_at, updated_at)
     VALUES (?, ?, ?, 'manual', 1, 'relative', ?, ?, ?)`,
    [`verify-b88-scenario-${runId}`, 'staging verification', 'synthetic; no message steps', lineAccountId, now, now],
  );
  for (let index = 0; index < 41; index++) {
    const suffix = String(index).padStart(2, '0');
    await query(
      `INSERT INTO friends
         (id, line_user_id, display_name, is_following, line_account_id, created_at, updated_at)
       VALUES (?, ?, 'staging verification', 1, ?, ?, ?)`,
      [`verify-b88-friend-${runId}-${suffix}`, `verify-b88-line-${runId}-${suffix}`, lineAccountId, now, now],
    );
    await query(
      `INSERT INTO friend_scenarios
         (id, friend_id, scenario_id, current_step_order, status, started_at, next_delivery_at, updated_at)
       VALUES (?, ?, ?, -1, 'active', ?, ?, ?)`,
      [
        `verify-b88-enrollment-${runId}-${suffix}`,
        `verify-b88-friend-${runId}-${suffix}`,
        `verify-b88-scenario-${runId}`,
        now,
        dueAt,
        now,
      ],
    );
  }
}

async function main(): Promise<void> {
  if (process.env.VERIFY_ENVIRONMENT !== 'staging') {
    throw new Error('VERIFY_ENVIRONMENT must be staging');
  }
  const target = readVerificationTarget(readFileSync(CONFIG_PATH, 'utf8'));
  const query = createD1Query(
    target,
    required('CLOUDFLARE_API_TOKEN', process.env.CLOUDFLARE_API_TOKEN),
  );
  const runId = randomUUID();
  const sessionToken = randomBytes(32).toString('base64url');
  const sessionHash = createHash('sha256').update(sessionToken).digest('hex');
  const now = normalizeScenarioDeliveryTimestamp(new Date().toISOString());
  const dueAt = normalizeScenarioDeliveryTimestamp(new Date(Date.now() - 60_000).toISOString());
  const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60_000).toISOString();
  if (!now || !dueAt) throw new Error('Could not normalize verification timestamps');

  let notificationRuleId: string | null = null;
  let apiDeletedRule = false;
  let cleanupFailures = 0;
  let report: Record<string, unknown> | null = null;

  try {
    const timestampRows = await query<ScenarioDeliveryTimestampRow>(
      `SELECT id, next_delivery_at FROM friend_scenarios
       WHERE next_delivery_at IS NOT NULL ORDER BY id`,
    );
    const timestampReport = analyzeScenarioDeliveryTimestamps(timestampRows);
    const nonCanonicalTimestamps = timestampReport.normalizable + timestampReport.invalid;
    if (nonCanonicalTimestamps !== 0) {
      throw new Error(`Expected 0 non-canonical timestamps; found ${nonCanonicalTimestamps}`);
    }

    const targets = await query<{ staff_id: string; line_account_id: string }>(
      `SELECT sm.id AS staff_id, la.id AS line_account_id
         FROM staff_members sm
         JOIN line_accounts la
           ON COALESCE(sm.tenant_id, ?) = COALESCE(la.tenant_id, ?)
        WHERE sm.is_active = 1
          AND sm.role IN ('owner', 'admin')
          AND la.is_active = 1
          AND (
            COALESCE(sm.account_scope, 'all') = 'all'
            OR EXISTS (
              SELECT 1 FROM staff_account_scopes sas
               WHERE sas.staff_id = sm.id AND sas.line_account_id = la.id
            )
          )
        ORDER BY sm.id, la.id
        LIMIT 1`,
      [DEFAULT_TENANT_ID, DEFAULT_TENANT_ID],
    );
    const verificationTarget = targets[0];
    if (!verificationTarget) throw new Error('No scoped staging administrator/account pair found');

    const legacyRows = await query<{ count: number }>(
      'SELECT COUNT(*) AS count FROM notification_rules WHERE line_account_id IS NULL',
    );
    const legacyUnscopedRules = Number(legacyRows[0]?.count ?? 0);

    await insertSyntheticDeliveryRows(
      query,
      runId,
      verificationTarget.line_account_id,
      now,
      dueAt,
    );
    const scenarioId = `verify-b88-scenario-${runId}`;
    const deliverySql = buildFriendScenariosDueForDeliveryQuery(true);
    const firstBatch = await query<DueEnrollment>(
      deliverySql,
      [now, scenarioId, SCENARIO_DELIVERY_BATCH_LIMIT],
    );
    if (firstBatch.length !== 40) throw new Error(`Expected first batch 40; found ${firstBatch.length}`);
    await query(
      `UPDATE friend_scenarios SET status = 'completed', updated_at = ?
       WHERE scenario_id = ? AND id IN (${firstBatch.map(() => '?').join(', ')})`,
      [now, scenarioId, ...firstBatch.map((row) => row.id)],
    );
    const secondBatch = await query<DueEnrollment>(
      deliverySql,
      [now, scenarioId, SCENARIO_DELIVERY_BATCH_LIMIT],
    );
    if (secondBatch.length !== 1) throw new Error(`Expected second batch 1; found ${secondBatch.length}`);

    await query(
      'INSERT INTO admin_sessions (token_hash, staff_id, expires_at) VALUES (?, ?, ?)',
      [sessionHash, verificationTarget.staff_id, expiresAt],
    );
    const created = await notificationRequest<{ id: string }>(
      target,
      sessionToken,
      '/api/notifications/rules',
      {
        method: 'POST',
        body: JSON.stringify({
          lineAccountId: verificationTarget.line_account_id,
          name: 'staging verification',
          eventType: 'staging_verification',
          conditions: { synthetic: true },
          channels: ['dashboard'],
        }),
      },
    );
    notificationRuleId = created.id;
    const listed = await notificationRequest<Array<{ id: string }>>(
      target,
      sessionToken,
      `/api/notifications/rules?lineAccountId=${encodeURIComponent(verificationTarget.line_account_id)}`,
    );
    if (!listed.some((rule) => rule.id === notificationRuleId)) {
      throw new Error('Created notification rule was not listed');
    }
    await notificationRequest<null>(
      target,
      sessionToken,
      `/api/notifications/rules/${encodeURIComponent(notificationRuleId)}?lineAccountId=${encodeURIComponent(verificationTarget.line_account_id)}`,
      { method: 'DELETE' },
    );
    apiDeletedRule = true;
    const afterDelete = await notificationRequest<Array<{ id: string }>>(
      target,
      sessionToken,
      `/api/notifications/rules?lineAccountId=${encodeURIComponent(verificationTarget.line_account_id)}`,
    );
    if (afterDelete.some((rule) => rule.id === notificationRuleId)) {
      throw new Error('Deleted notification rule was still listed');
    }

    report = {
      environment: 'staging',
      nonCanonicalNextDeliveryAt: nonCanonicalTimestamps,
      firstDueBatch: firstBatch.length,
      secondDueBatch: secondBatch.length,
      notificationRuleSaved: true,
      notificationRuleListed: true,
      notificationRuleDeleted: true,
      legacyUnscopedNotificationRules: legacyUnscopedRules,
      temporarySessionTtlMinutes: SESSION_TTL_MINUTES,
      lineMessagesSent: 0,
    };
  } finally {
    const cleanups: Array<() => Promise<unknown>> = [
      () => notificationRuleId
        ? query('DELETE FROM notification_rules WHERE id = ?', [notificationRuleId])
        : Promise.resolve(),
      () => query('DELETE FROM admin_sessions WHERE token_hash = ?', [sessionHash]),
      () => query('DELETE FROM friend_scenarios WHERE scenario_id = ?', [`verify-b88-scenario-${runId}`]),
      () => query('DELETE FROM scenarios WHERE id = ?', [`verify-b88-scenario-${runId}`]),
      () => query('DELETE FROM friends WHERE line_user_id LIKE ?', [`verify-b88-line-${runId}-%`]),
    ];
    for (const cleanup of cleanups) {
      try {
        await cleanup();
      } catch {
        cleanupFailures++;
      }
    }
  }

  if (cleanupFailures !== 0) throw new Error(`Staging cleanup failed ${cleanupFailures} time(s)`);
  if (!apiDeletedRule) throw new Error('Notification rule was not deleted through the API');
  const leftovers = await query<{ count: number }>(
    `SELECT
       (SELECT COUNT(*) FROM admin_sessions WHERE token_hash = ?) +
       (SELECT COUNT(*) FROM scenarios WHERE id = ?) +
       (SELECT COUNT(*) FROM friends WHERE line_user_id LIKE ?) +
       (SELECT COUNT(*) FROM friend_scenarios WHERE scenario_id = ?) +
       (SELECT COUNT(*) FROM notification_rules WHERE id = ?) AS count`,
    [
      sessionHash,
      `verify-b88-scenario-${runId}`,
      `verify-b88-line-${runId}-%`,
      `verify-b88-scenario-${runId}`,
      notificationRuleId,
    ],
  );
  const leftoverCount = Number(leftovers[0]?.count ?? 0);
  if (leftoverCount !== 0) throw new Error(`Expected 0 verification leftovers; found ${leftoverCount}`);
  console.log(JSON.stringify({ ...report, temporarySessionDeleted: true, verificationRowsDeleted: true }));
}

if (process.argv[1]?.endsWith('verify-staging-operational-path.ts')) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown staging verification failure';
    console.error(JSON.stringify({ success: false, error: message }));
    process.exitCode = 1;
  });
}
