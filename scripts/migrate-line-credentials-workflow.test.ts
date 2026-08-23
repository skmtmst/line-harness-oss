import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  new URL('../.github/workflows/migrate-line-credentials.yml', import.meta.url),
  'utf8',
);
const migrationScript = readFileSync(
  new URL('./migrate-line-account-credentials.ts', import.meta.url),
  'utf8',
);

describe('LINE credential migration workflow safety', () => {
  it('defaults to staging dry-run and only adds --apply in apply mode', () => {
    expect(workflow).toMatch(/environment:\n[\s\S]*?default: staging/);
    expect(workflow).toMatch(/mode:\n[\s\S]*?default: dry-run/);
    expect(workflow).toContain('if [ "$MIGRATION_MODE" = "apply" ]; then');
    expect(workflow.match(/--apply/g)).toHaveLength(1);
    const dryRunGuard = migrationScript.indexOf('if (!apply || rows.length === 0) return;');
    const updateStatement = migrationScript.indexOf('UPDATE line_accounts');
    expect(dryRunGuard).toBeGreaterThan(-1);
    expect(updateStatement).toBeGreaterThan(dryRunGuard);
  });

  it('uses the selected GitHub Environment and blocks unenabled production apply', () => {
    expect(workflow).toContain('name: ${{ inputs.environment }}');
    expect(workflow).toContain(
      "if: inputs.environment == 'production' && inputs.mode == 'apply'",
    );
    expect(workflow).toContain('LINE_CREDENTIAL_MIGRATION_APPLY_ENABLED');
  });

  it('passes only named secrets and never enables shell tracing or echoes values', () => {
    for (const name of [
      'CF_ACCOUNT_ID',
      'D1_DATABASE_ID',
      'CF_API_TOKEN',
      'LINE_CREDENTIAL_ENCRYPTION_KEY',
    ]) {
      expect(workflow).toContain(`${name}: \${{ secrets.${name} }}`);
    }
    expect(workflow).not.toMatch(/\bset\s+-x\b/);
    expect(workflow).not.toMatch(
      /echo[^\n]*\$(?:CF_ACCOUNT_ID|D1_DATABASE_ID|CF_API_TOKEN|LINE_CREDENTIAL_ENCRYPTION_KEY)/,
    );
  });

  it('limits migration script output to aggregate counts', () => {
    const outputCalls = migrationScript.match(/console\.(?:log|error)\([^\n]+/g) ?? [];
    expect(outputCalls).toEqual([
      "console.log(JSON.stringify({ pendingAccounts: rows.length }));",
      "console.log(JSON.stringify({ migratedAccounts: migrated }));",
      "console.error(JSON.stringify({ failedOperations: 1 }));",
    ]);
    expect(outputCalls.join('\n')).not.toMatch(
      /row\.|channel_|encrypted|encryptionKey|apiToken|accountId|databaseId/,
    );
  });
});
