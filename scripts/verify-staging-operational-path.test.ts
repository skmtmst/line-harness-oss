import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  createD1Query,
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
