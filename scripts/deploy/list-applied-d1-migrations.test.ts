import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

function run(mode: string) {
  const root = mkdtempSync(join(tmpdir(), 'd1-read-only-'));
  try {
    const log = join(root, 'queries');
    writeFileSync(join(root, 'npx'), `#!/bin/sh
printf '%s\\n' "$*" >> "$QUERY_LOG"
if [ "$FIXTURE_MODE" = failure ]; then exit 1; fi
if [ "$FIXTURE_MODE" = invalid ]; then printf '[{"success":false,"results":[]}]'; exit 0; fi
case "$*" in
  *sqlite_master*)
    if [ "$FIXTURE_MODE" = missing ]; then printf '[{"success":true,"results":[]}]';
    else printf '[{"success":true,"results":[{"name":"_migrations"}]}]'; fi ;;
  *) printf '[{"success":true,"results":[{"name":"001_init.sql"}]}]' ;;
esac
`, { mode: 0o755 });
    const result = spawnSync('bash', [fileURLToPath(new URL('./list-applied-d1-migrations.sh', import.meta.url)), 'fixture-db'], {
      encoding: 'utf8', env: { ...process.env, PATH: `${root}:${process.env.PATH}`, QUERY_LOG: log, FIXTURE_MODE: mode },
    });
    return { ...result, queries: readFileSync(log, 'utf8').trim().split('\n') };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
it('既存DBはSELECTだけで適用済みの名前を返す', () => {
  const result = run('existing');
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe('001_init.sql');
  expect(result.queries).toHaveLength(2);
  for (const query of result.queries) {
    expect(query).toContain('--command SELECT');
    expect(query).not.toMatch(/CREATE|INSERT|UPDATE|DELETE|ALTER|DROP/);
  }
});
it('履歴表なしは書き込まず空の一覧を返す', () => {
  const result = run('missing');
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe('');
  expect(result.queries).toHaveLength(1);
});
it.each(['failure', 'invalid'])('%sは空の一覧として成功させない', mode => {
  expect(run(mode).status).not.toBe(0);
});
