import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  createD1Query,
  insertSyntheticDeliveryRows,
  readVerificationTarget,
} from './verify-staging-operational-path.js';

const workflow = readFileSync(
  new URL('../.github/workflows/migrate-d1.yml', import.meta.url),
  'utf8',
);
const script = readFileSync(
  new URL('./verify-staging-operational-path.ts', import.meta.url),
  'utf8',
);
const stagingConfig = readFileSync(
  new URL('../apps/worker/wrangler.staging.toml', import.meta.url),
  'utf8',
);

describe('staging operational verification safety', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('accepts only the dedicated staging resources with cron disabled', () => {
    expect(readVerificationTarget(stagingConfig)).toMatchObject({
      workerUrl: 'https://nen-line-stg.skmtmst.workers.dev',
    });
    expect(() => readVerificationTarget(stagingConfig.replace('name = "nen-line-stg"', 'name = "production"')))
      .toThrow('Only the staging Worker is allowed');
    expect(() => readVerificationTarget(`${stagingConfig}\n[triggers]\ncrons = ["* * * * *"]`))
      .toThrow('must not have cron triggers');
  });

  test('operational check is limited to staging on codex/development', () => {
    expect(workflow).toContain("inputs.operation == 'verify-operational-path'");
    expect(workflow).toContain("inputs.environment == 'staging'");
    expect(workflow).toContain("github.ref == 'refs/heads/codex/development'");
    expect(workflow).toContain('name: staging');
    expect(workflow).toContain('VERIFY_ENVIRONMENT: staging');
    expect(workflow).toContain('set -o pipefail');
    expect(workflow).not.toMatch(/\bset\s+-x\b/);
  });

  test('retries a temporary D1 failure without exposing the provider response', async () => {
    const target = readVerificationTarget(stagingConfig);
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('network detail must stay hidden'))
      .mockResolvedValueOnce(new Response('temporary', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: [{ success: true, results: [{ count: 1 }] }],
      }), { status: 200 }));

    await expect(createD1Query(target, 'masked-token')<{ count: number }>('SELECT 1'))
      .resolves.toEqual([{ count: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('inserts 41 delivery rows in bounded batches instead of one request per row', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const query = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
      calls.push({ sql, params });
      return [];
    };

    await insertSyntheticDeliveryRows(
      query,
      'run-1',
      'account-1',
      '2026-09-04T01:00:00.000+09:00',
      '2026-09-04T00:59:00.000+09:00',
    );

    const friendInserts = calls.filter((call) => call.sql.includes('INSERT OR IGNORE INTO friends'));
    const enrollmentInserts = calls.filter((call) => call.sql.includes('INSERT OR IGNORE INTO friend_scenarios'));
    expect(calls).toHaveLength(11);
    expect(friendInserts).toHaveLength(5);
    expect(enrollmentInserts).toHaveLength(5);
    expect(friendInserts.flatMap((call) => call.params).filter(
      (value) => typeof value === 'string' && value.startsWith('verify-b88-friend-'),
    )).toHaveLength(41);
    expect(enrollmentInserts.flatMap((call) => call.params).filter(
      (value) => typeof value === 'string' && value.startsWith('verify-b88-enrollment-'),
    )).toHaveLength(41);
  });

  test('uses expiring session auth, aggregate output, and explicit cleanup', () => {
    expect(script).toContain('const SESSION_TTL_MINUTES = 15');
    expect(script).toContain("DELETE FROM admin_sessions WHERE token_hash = ?");
    expect(script).toContain("DELETE FROM notification_rules WHERE id = ?");
    expect(script).toContain("DELETE FROM admin_sessions WHERE expires_at <= ?");
    expect(script).toContain("lineMessagesSent: 0");
    expect(script).not.toMatch(/console\.(?:log|error)\([^\n]*(?:sessionToken|apiToken|staff_id|line_account_id)/);
  });

  test('calls only notification-rule API paths and never invokes cron or LINE delivery', () => {
    expect(script).toContain("path.startsWith('/api/notifications/rules')");
    expect(script).not.toContain('/webhook');
    expect(script).not.toContain('processStepDeliveries');
    expect(script).not.toContain('pushMessage');
    expect(script).not.toContain('multicast');
  });
});
