import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/deploy-cloudflare-staging.yml'),
  'utf8',
);

describe('Deploy Cloudflare Staging workflow', () => {
  it('supports a gated development push and still defaults manual runs to dry-run', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toMatch(/^\s+push:/m);
    expect(workflow).toMatch(/branches:\s*\n\s*- codex\/development/);
    expect(workflow).toContain("vars.NEN_STAGING_DELIVERY_MODE == 'dry-run'");
    expect(workflow).toContain("vars.NEN_STAGING_DELIVERY_MODE == 'apply'");
    expect(workflow).toContain('default: dry-run');
    expect(workflow).toContain('default: all');
  });

  it('can only run from codex/development against staging', () => {
    expect(workflow).toContain("github.ref == 'refs/heads/codex/development'");
    expect(workflow).toContain('environment: staging');
    expect(workflow).toContain('apps/worker/wrangler.staging.toml');
    expect(workflow).toContain('nen-line-stg-admin');
    expect(workflow).not.toContain('apps/worker/wrangler.toml');
  });

  it('acquires an exact deploy lock for apply and releases only after success', () => {
    expect(workflow).toContain('id: staging_lock');
    expect(workflow).toContain("if: env.DELIVERY_MODE == 'apply'");
    expect(workflow).toContain('pnpm deploy:lock acquire staging');
    expect(workflow).toContain(
      'pnpm deploy:lock verify staging --sha "$GITHUB_SHA" --remote origin',
    );
    expect(workflow).toContain("if: success() && steps.staging_lock.outcome == 'success'");
    expect(workflow).toContain('pnpm deploy:lock release staging --remote origin');
    expect(workflow.indexOf('pnpm deploy:lock acquire staging')).toBeLessThan(
      workflow.indexOf('npx wrangler deploy --config apps/worker/wrangler.staging.toml'),
    );
    expect(workflow.indexOf('pnpm deploy:lock release staging')).toBeGreaterThan(
      workflow.indexOf('npx wrangler pages deploy apps/web/out'),
    );
  });

  it('binds the ephemeral config to the staging Environment account', () => {
    expect(workflow).toContain('Bind the staging Cloudflare account');
    expect(workflow).toContain('CLOUDFLARE_ACCOUNT_ID');
    expect(workflow).toContain('apps/worker/wrangler.staging.toml');
    expect(workflow).not.toContain('echo "$CLOUDFLARE_ACCOUNT_ID"');
  });

  it('passes the staging Turnstile site key to the admin build', () => {
    expect(workflow).toContain(
      'NEXT_PUBLIC_TURNSTILE_SITE_KEY: ${{ vars.NEXT_PUBLIC_TURNSTILE_SITE_KEY }}',
    );
  });

  it('uses separate Worker and Pages credentials with safe fallbacks', () => {
    expect(workflow).toContain(
      'secrets.CLOUDFLARE_WORKERS_API_TOKEN || secrets.CLOUDFLARE_API_TOKEN || secrets.CF_API_TOKEN',
    );
    expect(workflow).toContain(
      'secrets.CLOUDFLARE_ACCOUNT_ID || secrets.CF_ACCOUNT_ID',
    );
    expect(workflow).toContain(
      'secrets.CLOUDFLARE_PAGES_API_TOKEN || secrets.CLOUDFLARE_API_TOKEN || secrets.CF_API_TOKEN',
    );
    expect(workflow).toContain('CLOUDFLARE_API_TOKEN: ${{ env.WORKER_API_TOKEN }}');
    expect(workflow).toContain('CLOUDFLARE_API_TOKEN: ${{ env.PAGES_API_TOKEN }}');
  });

  it('can deploy Worker and Admin independently', () => {
    expect(workflow).toContain("env.DELIVERY_TARGET != 'admin'");
    expect(workflow).toContain("env.DELIVERY_TARGET != 'worker'");
    expect(workflow).toContain("inputs.target || 'all'");
    expect(workflow).toContain(
      'pnpm --filter @line-harness/update-engine build',
    );
  });

  it('keeps cron disabled and migrations in their separate workflow', () => {
    expect(workflow).toContain("grep -q '^\\[triggers\\]'");
    expect(workflow).not.toContain('d1 migrations apply');
    expect(workflow).not.toContain('apply-d1-migrations');
  });
});
