import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = resolve(process.cwd(), 'scripts/deploy/cf-staging-deploy.sh');
const SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

/**
 * 外部コマンドを全部差し替えた砂場。tsx / wrangler / git / curl / node のどれも
 * 本物は動かず、呼ばれた引数だけをファイルに残す。Cloudflare にも D1 にも届かない。
 */
function makeSandbox(options: { newSql?: string; sqlBody?: string; healthCommit?: string } = {}) {
  const sandbox = mkdtempSync(resolve(tmpdir(), 'cf-staging-deploy-'));
  for (const dir of ['scripts/deploy', 'apps/worker', 'node_modules/.bin', 'bin', 'packages/db/migrations']) {
    mkdirSync(resolve(sandbox, dir), { recursive: true });
  }
  copyFileSync(script, resolve(sandbox, 'scripts/deploy/cf-staging-deploy.sh'));
  writeFileSync(resolve(sandbox, 'apps/worker/wrangler.staging.toml'), 'name = "nen-line-stg"\n');
  writeFileSync(resolve(sandbox, 'package.json'), JSON.stringify({ version: '0.24.0' }));
  if (options.newSql) {
    writeFileSync(resolve(sandbox, options.newSql), options.sqlBody ?? 'CREATE TABLE t (id INTEGER);\n');
  }
  const logArgs = (name: string) =>
    `#!/bin/sh\nprintf "%s\\n" "$@" >> "$PWD/${name}.args"\n`;
  // tsx の身代わりは、status のときだけ migrate.ts と同じ形で「これから当たるもの」を書く。
  const pendingName = options.newSql ? options.newSql.replace('packages/db/migrations/', '') : '';
  const pendingReport = pendingName
    ? `printf "\\nこれから当たるもの 1 件:\\n  ${pendingName}  (未適用)\\n"`
    : 'printf "対象: nen-line-stg (staging)\\n"';
  writeFileSync(
    resolve(sandbox, 'node_modules/.bin/tsx'),
    `#!/bin/sh\nprintf "%s\\n" "$@" >> "$PWD/tsx.args"\nif [ "$2" = status ]; then ${pendingReport}; fi\n`,
    { mode: 0o755 },
  );
  writeFileSync(resolve(sandbox, 'node_modules/.bin/wrangler'), logArgs('wrangler'), { mode: 0o755 });
  writeFileSync(
    resolve(sandbox, 'bin/git'),
    [
      '#!/bin/sh',
      `if [ "$1" = rev-parse ]; then printf "%s\\n" "${SHA}"; exit 0; fi`,
      'if [ "$1" = status ]; then exit 0; fi',
      'if [ "$1" = cat-file ]; then exit 1; fi',
      `if [ "$1" = log ]; then printf "%s\\n" "${options.newSql ?? ''}"; exit 0; fi`,
      'exit 0',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  // node は package.json の版の読み出しと、/health の JSON から git_commit を取り出すのに使う。
  writeFileSync(
    resolve(sandbox, 'bin/node'),
    [
      '#!/bin/sh',
      'case "$*" in',
      '  *package.json*) printf "%s\\n" "0.24.0" ;;',
      `  *) printf "%s" "${options.healthCommit ?? ''}" ;;`,
      'esac',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  writeFileSync(
    resolve(sandbox, 'bin/curl'),
    options.healthCommit ? '#!/bin/sh\nprintf "{}"\n' : '#!/bin/sh\nexit 7\n',
    { mode: 0o755 },
  );
  writeFileSync(resolve(sandbox, 'bin/sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return sandbox;
}

function run(sandbox: string, env: Record<string, string> = {}) {
  return spawnSync('bash', [resolve(sandbox, 'scripts/deploy/cf-staging-deploy.sh')], {
    cwd: sandbox,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${resolve(sandbox, 'bin')}:${process.env.PATH}`, ...env },
  });
}

const read = (sandbox: string, name: string) => {
  try {
    return readFileSync(resolve(sandbox, `${name}.args`), 'utf8');
  } catch {
    return '';
  }
};

describe('cf-staging-deploy', () => {
  const sandboxes: string[] = [];
  afterEach(() => {
    for (const s of sandboxes.splice(0)) rmSync(s, { recursive: true, force: true });
  });

  it('defaults to plan: dry-run deploy, no D1 write, version vars passed', () => {
    const sandbox = makeSandbox();
    sandboxes.push(sandbox);
    const result = run(sandbox);
    expect(result.status, result.stderr).toBe(0);
    const wrangler = read(sandbox, 'wrangler');
    expect(wrangler).toContain('--dry-run');
    expect(wrangler).toContain(`BUILD_GIT_COMMIT:${SHA}`);
    expect(wrangler).toContain('wrangler.staging.toml');
    const tsx = read(sandbox, 'tsx');
    expect(tsx).toContain('status\nstaging');
    expect(tsx).not.toContain('--apply');
    expect(result.stdout).toContain('plan のため Cloudflare へは反映していません');
  });

  it('apply: migrates with --apply, deploys without --dry-run, verifies /health commit', () => {
    const sandbox = makeSandbox({ healthCommit: SHA });
    sandboxes.push(sandbox);
    const result = run(sandbox, { CF_STAGING_DEPLOY_MODE: 'apply' });
    expect(result.status, result.stderr).toBe(0);
    expect(read(sandbox, 'tsx')).toContain('apply\nstaging\n--apply');
    const wrangler = read(sandbox, 'wrangler');
    expect(wrangler).toContain('deploy');
    expect(wrangler).not.toContain('--dry-run');
    expect(result.stdout).toContain(`/health の git_commit = ${SHA} を確認しました`);
  });

  it('applies when the pending migration is additive', () => {
    const sandbox = makeSandbox({ newSql: 'packages/db/migrations/902_ok.sql', healthCommit: SHA });
    sandboxes.push(sandbox);
    const result = run(sandbox, { CF_STAGING_DEPLOY_MODE: 'apply' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('902_ok.sql');
    expect(result.stdout).toContain('追加のみの文です');
    expect(read(sandbox, 'tsx')).toContain('apply\nstaging\n--apply');
  });

  it('stops before touching D1 when a pending migration is not additive', () => {
    const sandbox = makeSandbox({
      newSql: 'packages/db/migrations/900_bad.sql',
      sqlBody: '-- comment with DROP TABLE is fine\nDROP TABLE friends;\n',
    });
    sandboxes.push(sandbox);
    const result = run(sandbox, { CF_STAGING_DEPLOY_MODE: 'apply' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('追加のみではない文があります');
    expect(read(sandbox, 'tsx')).not.toContain('--apply');
    expect(read(sandbox, 'wrangler')).toBe('');
  });

  it('stops on table-rebuild marker even when statements look additive', () => {
    const sandbox = makeSandbox({
      newSql: 'packages/db/migrations/901_rebuild.sql',
      sqlBody: '-- migration-policy: table-rebuild\nCREATE TABLE friends_new (id INTEGER);\n',
    });
    sandboxes.push(sandbox);
    const result = run(sandbox, { CF_STAGING_DEPLOY_MODE: 'apply' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('table-rebuild');
  });

  it('retries a D1 step that fails once (API throttling)', () => {
    const sandbox = makeSandbox({ healthCommit: SHA });
    sandboxes.push(sandbox);
    // 1 回目の status だけ失敗し、2 回目から通る tsx の身代わり。
    writeFileSync(
      resolve(sandbox, 'node_modules/.bin/tsx'),
      [
        '#!/bin/sh',
        'printf "%s\\n" "$@" >> "$PWD/tsx.args"',
        'if [ "$2" = status ] && [ ! -f "$PWD/.failed-once" ]; then touch "$PWD/.failed-once"; exit 1; fi',
        'if [ "$2" = status ]; then printf "対象: nen-line-stg (staging)\\n"; fi',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    const result = run(sandbox, { CF_STAGING_DEPLOY_MODE: 'apply', CF_STAGING_RETRY_WAIT: '0' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('失敗しました（1/4）');
    expect(read(sandbox, 'tsx').split('status\nstaging').length - 1).toBe(2);
    expect(read(sandbox, 'wrangler')).not.toContain('--dry-run');
  });

  it('rejects an unknown mode and a dirty tree', () => {
    const sandbox = makeSandbox();
    sandboxes.push(sandbox);
    expect(run(sandbox, { CF_STAGING_DEPLOY_MODE: 'yolo' }).status).toBe(1);
    writeFileSync(resolve(sandbox, 'bin/git'), '#!/bin/sh\nif [ "$1" = status ]; then echo " M x"; fi\nexit 0\n', { mode: 0o755 });
    const dirty = run(sandbox);
    expect(dirty.status).toBe(1);
    expect(dirty.stderr).toContain('作業ツリーが汚れています');
  });
});
