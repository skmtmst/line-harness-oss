import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manualWorkflow = readFileSync(
  new URL('../.github/workflows/migrate-d1.yml', import.meta.url),
  'utf8',
);
const productionWorkflow = readFileSync(
  new URL('../.github/workflows/deploy-cloudflare-worker.yml', import.meta.url),
  'utf8',
);
const applyScript = readFileSync(
  new URL('./deploy/apply-d1-migrations.sh', import.meta.url),
  'utf8',
);

const workflows = [manualWorkflow, productionWorkflow];

describe('D1 migration workflow safety', () => {
  it('uses the selected GitHub Environment and defaults to staging dry-run', () => {
    expect(manualWorkflow).toMatch(/environment:\n[\s\S]*?default: staging/);
    expect(manualWorkflow).toMatch(/mode:\n[\s\S]*?default: dry-run/);
    expect(manualWorkflow).toContain('name: ${{ inputs.environment }}');
  });

  it('can select one exact migration without applying other pending files', () => {
    expect(manualWorkflow).toMatch(/migration:\n[\s\S]*?type: string/);
    expect(manualWorkflow).toContain('TARGET_MIGRATION: ${{ inputs.migration }}');
    expect(manualWorkflow).toContain("grep -Eq '^[0-9]{3,}_[A-Za-z0-9_-]+\\.sql$'");
    expect(manualWorkflow).toContain('grep -qxF "$target_path" "$all_pending_file"');
    expect(manualWorkflow).toContain('printf \'%s\\n\' "$target_path" > "$apply_file"');
    expect(manualWorkflow).toContain('cp "$all_pending_file" "$apply_file"');
  });

  it('accepts the Environment-scoped Cloudflare secret names', () => {
    expect(manualWorkflow).toContain(
      'CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN || secrets.CLOUDFLARE_API_TOKEN }}',
    );
    expect(manualWorkflow).toContain(
      'CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID || secrets.CLOUDFLARE_ACCOUNT_ID }}',
    );
  });

  it('does not print credentials or enable shell tracing', () => {
    for (const source of [...workflows, applyScript]) {
      expect(source).not.toMatch(/\bset\s+-x\b/);
      expect(source).not.toMatch(
        /echo[^\n]*\$(?:CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|CF_API_TOKEN|CF_ACCOUNT_ID)/,
      );
    }
  });

  it('passes one fixed pending list to the same apply script in both workflows', () => {
    for (const workflow of workflows) {
      expect(workflow).toContain(
        '"$RUNNER_TEMP/d1-pending-migrations.txt"',
      );
      expect(workflow).toContain(
        'bash scripts/deploy/apply-d1-migrations.sh',
      );
      expect(workflow).not.toContain(
        'SELECT name FROM _migrations WHERE name =',
      );
    }
  });

  it('records migrations idempotently in the shared script', () => {
    expect(applyScript).toContain('INSERT OR IGNORE INTO _migrations');
    expect(applyScript).not.toContain(
      'SELECT name FROM _migrations WHERE name =',
    );
  });

  it('keeps Time Travel fail-closed in both workflows', () => {
    for (const workflow of workflows) {
      expect(workflow).toContain('d1 time-travel info');
      expect(workflow).toContain(
        'Time Travel のブックマークを取れませんでした。戻る先が無いので中止します。',
      );
    }
  });
});
