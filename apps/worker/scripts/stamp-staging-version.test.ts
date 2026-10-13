import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { stampStagingVersion } from './stamp-staging-version.js';

const roots: string[] = [];
afterEach(() => { roots.forEach(root => rmSync(root, { recursive: true, force: true })); vi.unstubAllEnvs(); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'staging-metadata-'));
  roots.push(root);
  mkdirSync(join(root, 'apps/worker/src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"version":"0.24.0"}');
  writeFileSync(join(root, 'apps/worker/src/_version.ts'), readFileSync(new URL('../src/_version.ts', import.meta.url)));
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture']);
  return root;
}
it('config replayはworkflowのSHAでなく配備元のHEADを埋め、実在しないhashを作らない', () => {
  const root = fixture();
  const sha = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  vi.stubEnv('GITHUB_SHA', 'f'.repeat(40));
  const original = readFileSync(join(root, 'apps/worker/src/_version.ts'), 'utf8');
  expect(stampStagingVersion(root, '2026-10-10T00:00:00Z')).toEqual({ version: '0.24.0', commit: sha, releasedAt: '2026-10-10T00:00:00Z' });
  const source = readFileSync(join(root, 'apps/worker/src/_version.ts'), 'utf8');
  expect(source).toContain(`GIT_COMMIT = "${sha}";`);
  expect(source).toContain('BUNDLE_VERSION = "0.24.0";');
  expect(source).toContain('RELEASED_AT = "2026-10-10T00:00:00Z";');
  expect(source.match(/export const \w+_HASH = [^;]+;/g)).toEqual(original.match(/export const \w+_HASH = [^;]+;/g));
});
it('SHAを確認できない場合は埋め込みを止める', () => {
  const root = fixture();
  rmSync(join(root, '.git'), { recursive: true, force: true });
  expect(() => stampStagingVersion(root)).toThrow();
});
it('版の値が不正なら元の定数を変更しない', () => {
  const root = fixture();
  const path = join(root, 'apps/worker/src/_version.ts');
  const original = readFileSync(path, 'utf8');
  writeFileSync(join(root, 'package.json'), '{"version":"unknown"}');
  expect(() => stampStagingVersion(root)).toThrow('版を確認できません');
  expect(readFileSync(path, 'utf8')).toBe(original);
});
