import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// scripts/codex/doctor.sh の直接契約テスト。
// curl と gh をスタブに差し替え、通信と秘密の有無だけを切り替えて判定を見る。
// 秘密の値はテストでも扱わない。漏えい検査用のカナリアは出力に現れてはならない。

const script = resolve(process.cwd(), 'scripts/codex/doctor.sh');

const LOCAL_CREDENTIAL_VARS = [
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_WORKERS_API_TOKEN',
  'CLOUDFLARE_PAGES_API_TOKEN',
  'CF_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'CF_ACCOUNT_ID',
] as const;

const ALL_STAGING_NAMES = [
  'CLOUDFLARE_WORKERS_API_TOKEN',
  'CLOUDFLARE_PAGES_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
].join(' ');

const CURL_STUB = `#!/bin/sh
url="$1"
while [ $# -gt 0 ]; do url="$1"; shift; done
case "$url" in
  *api.cloudflare.com*) code="\${STUB_CF_CODE:-404}" ;;
  *api.github.com*) code="\${STUB_GITHUB_CODE:-200}" ;;
  *registry.npmjs.org*) code="\${STUB_NPM_CODE:-200}" ;;
  *) code="200" ;;
esac
printf '%s' "$code"
[ "$code" = "000" ] && exit 1
exit 0
`;

const GH_STUB = `#!/bin/sh
if [ "$1" = "auth" ]; then
  [ "\${STUB_GH_AUTH:-ok}" = "ok" ] && exit 0 || exit 1
fi
if [ "$1" = "secret" ]; then
  [ "\${STUB_GH_LIST_OK:-ok}" = "ok" ] || exit 1
  # 本物の gh --jq と同じく秘密名だけを 1 行ずつ出す。値は出さない。
  for name in $STUB_GH_SECRETS; do printf '%s\\n' "$name"; done
  exit 0
fi
exit 1
`;

function setupStubs(): string {
  const dir = mkdtempSync(join(tmpdir(), 'doctor-stub-'));
  const curlPath = join(dir, 'curl');
  const ghPath = join(dir, 'gh');
  writeFileSync(curlPath, CURL_STUB, 'utf8');
  writeFileSync(ghPath, GH_STUB, 'utf8');
  chmodSync(curlPath, 0o755);
  chmodSync(ghPath, 0o755);
  return dir;
}

function runDoctor(extraEnv: Record<string, string> = {}): {
  status: number | null;
  stdout: string;
} {
  const stubDir = setupStubs();
  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: `${stubDir}:${process.env.PATH ?? ''}`,
    ...extraEnv,
  };
  for (const name of LOCAL_CREDENTIAL_VARS) {
    if (!(name in extraEnv)) {
      delete env[name];
    }
  }
  if (!('DOCTOR_LOCAL' in extraEnv)) {
    delete env.DOCTOR_LOCAL;
  }
  const result = spawnSync('bash', [script], { encoding: 'utf8', env });
  return { status: result.status, stdout: result.stdout ?? '' };
}

function lastLine(stdout: string): string {
  return stdout.trim().split('\n').pop() ?? '';
}

describe('doctor Cloudflare 判定（#661）', () => {
  it('404 到達・ローカルなし・staging 完備なら最終行が合格になる', () => {
    const { status, stdout } = runDoctor({
      STUB_CF_CODE: '404',
      STUB_GH_SECRETS: ALL_STAGING_NAMES,
    });

    expect(status).toBe(0);
    expect(lastLine(stdout)).toBe('合格');
    expect(stdout).toContain('到達成功');
    expect(stdout).toContain('Worker 用 token: staging に設定あり');
    expect(stdout).toContain('Pages 用 token: staging に設定あり');
    expect(stdout).toContain('Account ID: staging に設定あり');
  });

  it('HTTP 000 だけが到達失敗で要確認になる', () => {
    const { status, stdout } = runDoctor({
      STUB_CF_CODE: '000',
      STUB_GH_SECRETS: ALL_STAGING_NAMES,
    });

    expect(status).toBe(1);
    expect(lastLine(stdout)).toContain('要確認');
    expect(lastLine(stdout)).toContain('Cloudflare APIへ到達できない');
  });

  it('Worker 用の秘密名が不足すると要確認になり、足りている役割は通る', () => {
    const { status, stdout } = runDoctor({
      STUB_CF_CODE: '404',
      STUB_GH_SECRETS: 'CLOUDFLARE_PAGES_API_TOKEN CLOUDFLARE_ACCOUNT_ID',
    });

    expect(status).toBe(1);
    expect(lastLine(stdout)).toContain('要確認');
    expect(stdout).toContain('Worker 用 token: staging に不足');
    expect(stdout).toContain('Pages 用 token: staging に設定あり');
    expect(stdout).toContain('Account ID: staging に設定あり');
  });

  it('CF_API_TOKEN だけでも Worker と Pages の代わりになる', () => {
    const { status, stdout } = runDoctor({
      STUB_CF_CODE: '404',
      STUB_GH_SECRETS: 'CF_API_TOKEN CF_ACCOUNT_ID',
    });

    expect(status).toBe(0);
    expect(lastLine(stdout)).toBe('合格');
  });

  it('gh 未認証なら要確認になる', () => {
    const { status, stdout } = runDoctor({
      STUB_CF_CODE: '404',
      STUB_GH_AUTH: 'fail',
      STUB_GH_SECRETS: ALL_STAGING_NAMES,
    });

    expect(status).toBe(1);
    expect(lastLine(stdout)).toContain('要確認');
    expect(stdout).toContain('gh 未認証のため確認不可');
  });

  it('ローカルに秘密があれば要確認になり、値は一文字も出ない', () => {
    const canary = 'CANARY-TOKEN-VALUE-9f8e7d6c5b4a';
    const { status, stdout } = runDoctor({
      STUB_CF_CODE: '404',
      STUB_GH_SECRETS: ALL_STAGING_NAMES,
      CLOUDFLARE_API_TOKEN: canary,
    });

    expect(status).toBe(1);
    expect(lastLine(stdout)).toContain('要確認');
    expect(stdout).toContain('CLOUDFLARE_API_TOKENが設定されている');
    expect(stdout).not.toContain(canary);
  });

  it('DOCTOR_LOCAL=1 でも staging 照合は走り、そろえば合格になる', () => {
    const { status, stdout } = runDoctor({
      DOCTOR_LOCAL: '1',
      STUB_GH_SECRETS: ALL_STAGING_NAMES,
    });

    expect(status).toBe(0);
    expect(lastLine(stdout)).toBe('合格');
    expect(stdout).toContain('判定なし');
  });
});
