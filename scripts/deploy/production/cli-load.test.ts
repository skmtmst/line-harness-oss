import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('production deploy command loading', () => {
  it('loads the preflight imports before rejecting an invalid release SHA', () => {
    const result = spawnSync('pnpm', ['exec', 'tsx', 'scripts/deploy/production/run.ts', 'admin-artifact'], {
      cwd: process.cwd(),
      env: { ...process.env, RELEASE_SHA: 'invalid' },
      encoding: 'utf8',
      timeout: 15_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('admin-artifact: FAIL');
    expect(result.stderr).not.toMatch(/Transform failed|Top-level await/);
  });
});
