import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  new URL('../../../.github/workflows/deploy-cloudflare-docs.yml', import.meta.url),
  'utf8',
);

describe('Cloudflare docs deployment workflow', () => {
  it('is valid YAML and targets only the development integration branch and staging', () => {
    const parsed = parse(workflow) as {
      name?: string;
      on?: Record<string, unknown>;
      jobs?: Record<string, { environment?: string }>;
    };

    expect(parsed.name).toBe('Deploy Cloudflare Docs (Staging)');
    expect(parsed.on).toMatchObject({
      workflow_dispatch: null,
      push: { branches: ['codex/development'] },
    });
    expect(parsed.jobs?.deploy?.environment).toBe('staging');
    expect(workflow).not.toMatch(/branches:\s*\[main\]/);
  });

  it('builds and verifies the docs app before deploying its static output', () => {
    expect(workflow).toContain('pnpm --filter docs build');
    expect(workflow).toContain('pnpm --filter docs test:export');
    expect(workflow).toContain(
      'npx wrangler pages deploy apps/docs/out --project-name="$PAGES_DOCS_PROJECT_NAME"',
    );
  });

  it('uses only named GitHub secrets and does not print their values', () => {
    expect(workflow).toContain("vars.PAGES_DOCS_DEPLOY_ENABLED == 'true'");
    expect(workflow).not.toContain('LINE_HARNESS_CLOUDFLARE_DEPLOY');
    expect(workflow).toContain(
      'CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}',
    );
    expect(workflow).toContain(
      'CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}',
    );
    expect(workflow).toContain(
      'PAGES_DOCS_PROJECT_NAME: ${{ secrets.PAGES_DOCS_PROJECT_NAME }}',
    );
    expect(workflow).not.toMatch(/\bset\s+-x\b/);
    expect(workflow).not.toMatch(
      /echo[^\n]*\$(?:CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|PAGES_DOCS_PROJECT_NAME)/,
    );
  });
});
