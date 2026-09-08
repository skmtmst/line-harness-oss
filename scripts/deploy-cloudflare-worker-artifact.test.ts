import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 本番配備 workflow は worker build が実際に作った wrangler.json だけを
// 参照する。置き場所の決め打ちは改名のたびにずれるので契約で禁じる。
const workflow = readFileSync(
  new URL('../.github/workflows/deploy-cloudflare-worker.yml', import.meta.url),
  'utf8',
);
const workerSourceConfig = readFileSync(
  new URL('../apps/worker/wrangler.toml', import.meta.url),
  'utf8',
);

// 正本は apps/worker/wrangler.toml の name。
// @cloudflare/vite-plugin は worker 名の - を _ に直した名前の Vite 環境を
// 作り、その環境名のフォルダへ wrangler.json を出す
// (workerNameToEnvironmentName → dist/<環境名>/wrangler.json)。
function expectedArtifactDir(): string {
  const match = workerSourceConfig.match(/^name\s*=\s*"([^"]+)"$/m);
  const workerName = match?.[1] ?? '';
  if (!workerName) {
    throw new Error('apps/worker/wrangler.toml から name を読めません');
  }
  return workerName.replaceAll('-', '_');
}

describe('deploy-cloudflare-worker artifact path', () => {
  it('does not hardcode any dist/<name>/wrangler.json path', () => {
    expect(workflow).not.toMatch(/dist\/[A-Za-z0-9_]+\/wrangler\.json/);
  });

  it('derives the artifact path from the canonical worker name', () => {
    expect(workflow).toContain('Resolve worker build artifact path');
    expect(workflow).toContain('apps/worker/wrangler.toml');
    expect(workflow).toContain("tr '-' '_'");
    expect(workflow).toContain('WORKER_DEPLOY_CONFIG');
  });

  it('fails closed with a clear error when the artifact is missing', () => {
    expect(workflow).toContain('Verify worker build artifact');
    expect(workflow).toContain('apps/worker/$WORKER_DEPLOY_CONFIG');
    expect(workflow).toContain('::error::');
    expect(workflow).toContain('exit 1');
  });

  it('verifies nodejs_compat in the generated artifact before patching', () => {
    expect(workflow).toContain('compatibility_flags');
    expect(workflow).toContain('nodejs_compat');
  });

  it('deploys only the derived artifact config', () => {
    expect(workflow).toContain(
      'deploy --config ${{ env.WORKER_DEPLOY_CONFIG }}',
    );
  });

  it('derives the same directory the real build produces', () => {
    // 改名したらこの期待値の更新が要る。黙ってずれるよりは
    // 目に見えて落ちる方を選ぶ。
    expect(`dist/${expectedArtifactDir()}/wrangler.json`).toBe(
      'dist/nen_line/wrangler.json',
    );
  });
});
