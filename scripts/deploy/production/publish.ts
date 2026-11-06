import { readFileSync } from 'node:fs';
import { unstable_readConfig } from 'wrangler';
import { assertWorkerConfig, workerArtifactPath } from './artifacts.js';
import { assertSha, command, requireValue } from './common.js';

/** Hide provider logs (binding values, domains, cookies, error bodies). */
export function publishWorker(sha: string): void {
  assertSha(sha);
  const source = unstable_readConfig({ config: 'apps/worker/wrangler.toml' });
  const path = workerArtifactPath(source.name), candidate = JSON.parse(readFileSync(path, 'utf8'));
  assertWorkerConfig(source, candidate);
  if (candidate.vars?.BUILD_GIT_COMMIT !== sha) throw new Error('artifact_sha');
  command('npx', ['wrangler', 'deploy', '--config', path]);
}
export function publishAdmin(sha: string): void {
  assertSha(sha);
  const source = unstable_readConfig({ config: 'apps/worker/wrangler.toml' });
  const project = requireValue(process.env.PAGES_PROJECT_NAME);
  if (project !== source.vars.ADMIN_PAGES_PROJECT) throw new Error('pages_project');
  const version = JSON.parse(readFileSync('apps/web/out/version.json', 'utf8'));
  if (version.git_commit !== sha) throw new Error('artifact_sha');
  command('npx', ['wrangler', 'pages', 'deploy', 'apps/web/out', '--project-name', project, '--branch', 'main', '--commit-hash', sha, '--commit-message', `production ${sha}`]);
}
