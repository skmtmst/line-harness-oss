import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

  it('passes the local Turnstile site key to the admin build', () => {
    const source = readFileSync(script, 'utf8');

    expect(source).toContain(
      'NEXT_PUBLIC_TURNSTILE_SITE_KEY="${NEXT_PUBLIC_TURNSTILE_SITE_KEY:-}"',
    );
  });

  it.each([undefined, 'v7'])('builds staging without selecting the retired theme when the caller value is %s (isolated commands)', (callerTheme) => {
    const sandbox = mkdtempSync(resolve(tmpdir(), 'pretheme-deploy-'));
    try {
      for (const dir of ['scripts/deploy', 'apps/worker', 'node_modules/.bin', 'bin', 'parent/.git']) {
        mkdirSync(resolve(sandbox, dir), { recursive: true });
      }
      copyFileSync(script, resolve(sandbox, 'scripts/deploy/staging-deploy.sh'));
      writeFileSync(resolve(sandbox, 'apps/worker/wrangler.staging.toml'), 'account_id = "test-account"\n');
      // Every external command is replaced. Neither the real preflight nor Cloudflare runs.
      for (const name of ['tsx', 'wrangler']) {
        writeFileSync(resolve(sandbox, 'node_modules/.bin', name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      }
      writeFileSync(resolve(sandbox, 'bin/git'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      writeFileSync(resolve(sandbox, 'bin/pnpm'), '#!/bin/sh\nif [ "$2" = web ]; then printf "theme=%s api=%s\\n" "${NEXT_PUBLIC_ADMIN_THEME-unset}" "$NEXT_PUBLIC_API_URL"; fi\n', { mode: 0o755 });
      const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${resolve(sandbox, 'bin')}:${process.env.PATH}` };
      delete env.NEXT_PUBLIC_ADMIN_THEME;
      if (callerTheme) env.NEXT_PUBLIC_ADMIN_THEME = callerTheme;
      const result = spawnSync('bash', [resolve(sandbox, 'scripts/deploy/staging-deploy.sh'), '--parent-repo', resolve(sandbox, 'parent')], { env, encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(`theme=${callerTheme ?? 'unset'} api=https://stg-api.musubo.jp`);
      expect(result.stdout).toContain('dry-run: pages deploy は実行していません');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
