import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  new URL('../.github/workflows/migrate-d1.yml', import.meta.url),
  'utf8',
);

describe('D1 migration workflow safety', () => {
  it('uses the selected GitHub Environment and defaults to staging dry-run', () => {
    expect(workflow).toMatch(/environment:\n[\s\S]*?default: staging/);
    expect(workflow).toMatch(/mode:\n[\s\S]*?default: dry-run/);
    expect(workflow).toContain('name: ${{ inputs.environment }}');
  });

  it('accepts the Environment-scoped Cloudflare secret names', () => {
    expect(workflow).toContain(
      'CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN || secrets.CLOUDFLARE_API_TOKEN }}',
    );
    expect(workflow).toContain(
      'CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID || secrets.CLOUDFLARE_ACCOUNT_ID }}',
    );
  });

  it('does not print credentials or enable shell tracing', () => {
    expect(workflow).not.toMatch(/\bset\s+-x\b/);
    expect(workflow).not.toMatch(
      /echo[^\n]*\$(?:CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|CF_API_TOKEN|CF_ACCOUNT_ID)/,
    );
  });
});
