import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/deploy-cloudflare-staging.yml'),
  'utf8',
);

describe('Deploy Cloudflare Staging workflow', () => {
  it('is manual-only and defaults to dry-run', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^\s+push:/m);
    expect(workflow).toContain('default: dry-run');
  });

  it('can only run from codex/development against staging', () => {
    expect(workflow).toContain("github.ref == 'refs/heads/codex/development'");
    expect(workflow).toContain('environment: staging');
    expect(workflow).toContain('apps/worker/wrangler.staging.toml');
    expect(workflow).toContain('nen-line-stg-admin');
    expect(workflow).not.toContain('apps/worker/wrangler.toml');
  });

  it('requires an exact deploy lock before apply', () => {
    expect(workflow).toContain('if [ "$MODE" = "apply" ]');
    expect(workflow).toContain(
      'pnpm deploy:lock verify staging --sha "$GITHUB_SHA" --remote origin',
    );
  });

  it('keeps cron disabled and migrations in their separate workflow', () => {
    expect(workflow).toContain("grep -q '^\\[triggers\\]'");
    expect(workflow).not.toContain('d1 migrations apply');
    expect(workflow).not.toContain('apply-d1-migrations');
  });
});
