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
  it('dry-run lists via SELECT-only CLI; ledger DDL is behind the apply gate and backup', () => {
    const pending = manualWorkflow.split('- name: List the pending migrations')[1].split('- name: Take a Time Travel bookmark')[0];
    expect(pending).toContain('node scripts/deploy/d1-pending-readonly.mjs');
    expect(pending).not.toMatch(/CREATE TABLE|INSERT |ALTER |DROP |wrangler d1 execute/);
    const apply = manualWorkflow.split('- name: Apply the pending migrations')[1].split('- name: Say what happened')[0];
    expect(apply).toContain("if: inputs.mode == 'apply' && steps.pending.outputs.count != '0'");
    expect(apply).toContain('CREATE TABLE IF NOT EXISTS _migrations');
  });
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

  it('does not use the runner context in job-level env (steps only)', () => {
    // `runner.temp` などは step の中でだけ有効。job の env に書くと
    // workflow 自体が「Unrecognized named-value: runner」で起動すらしない。
    // job の env は4空白、step の env は8空白なので字下げで見分ける。
    const jobEnvBlocks =
      manualWorkflow.match(/^ {4}env:\n(?: {6}\S[^\n]*\n?)+/gm) ?? [];
    expect(jobEnvBlocks.length).toBeGreaterThan(0);
    for (const block of jobEnvBlocks) {
      expect(block).not.toContain('${{ runner.');
    }
  });
  it('lists read-only and creates migration history only in apply after the bookmark', () => {
    const pending = manualWorkflow.split('- name: List the pending migrations')[1].split('- name: Take a Time Travel bookmark')[0];
    expect(pending).toContain('list-applied-d1-migrations.sh');
    expect(pending).not.toContain('CREATE TABLE');
    expect(pending).toContain('total_count=$pending_count');
    expect(pending).toContain('未適用の総数: ${pending_count} 件');
    const apply = manualWorkflow.split('- name: Apply the pending migrations')[1].split('- name: Say what happened')[0];
    expect(apply).toContain("if: inputs.mode == 'apply' && steps.pending.outputs.count != '0'");
    expect(apply).toContain('CREATE TABLE IF NOT EXISTS _migrations');
    expect(manualWorkflow.indexOf('Take a Time Travel bookmark')).toBeLessThan(manualWorkflow.indexOf('CREATE TABLE IF NOT EXISTS _migrations'));
  });

});
