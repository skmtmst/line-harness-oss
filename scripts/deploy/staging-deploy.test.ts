import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = resolve(process.cwd(), 'scripts/deploy/staging-deploy.sh');

describe('staging-deploy argument parsing', () => {
  it('accepts the option separator forwarded by pnpm', () => {
    const result = spawnSync('bash', [script, '--', '--help'], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('不明な引数: --');
    expect(result.stdout).toContain('scripts/deploy/staging-deploy.sh --apply');
  });

  it('continues to reject unknown options', () => {
    const result = spawnSync('bash', [script, '--unknown'], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('不明な引数: --unknown');
  });
});
