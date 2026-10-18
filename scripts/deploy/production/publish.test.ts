import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  source: { name: 'synthetic-worker', workers_dev: true, routes: [{ pattern: 'example.invalid', custom_domain: true }], compatibility_flags: ['nodejs_compat', 'global_fetch_strictly_public'], d1_databases: [{ binding: 'DB', database_name: 'synthetic', database_id: 'synthetic-id' }], r2_buckets: [{ binding: 'IMAGES', bucket_name: 'synthetic-images' }], vars: { ADMIN_PAGES_PROJECT: 'synthetic-admin' } },
  candidate: {} as Record<string, unknown>, adminSha: '',
}));
vi.mock('wrangler', () => ({ unstable_readConfig: () => fixture.source }));
vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>(), readFileSync: (path: string) => JSON.stringify(path.endsWith('version.json') ? { git_commit: fixture.adminSha } : fixture.candidate) }));
import * as common from './common.js';
import { publishAdmin, publishWorker } from './publish.js';
const sha = 'a'.repeat(40);
beforeEach(() => {
  fixture.candidate = { ...structuredClone(fixture.source), vars: { BUILD_GIT_COMMIT: sha } };
  fixture.adminSha = sha;
  vi.stubEnv('PAGES_PROJECT_NAME', 'synthetic-admin');
  vi.spyOn(common, 'command').mockReturnValue('synthetic provider output never logged');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe('publication uses the exact checked artifact and canonical SHA', () => {
  it('passes only the generated Worker config to Wrangler', () => {
    publishWorker(sha);
    expect(common.command).toHaveBeenCalledExactlyOnceWith('npx', ['wrangler', 'deploy', '--config', 'apps/worker/dist/synthetic_worker/wrangler.json']);
  });
  it.each(['sha', 'route', 'binding'])('does not publish a Worker with %s drift', field => {
    if (field === 'sha') fixture.candidate.vars = { BUILD_GIT_COMMIT: 'b'.repeat(40) };
    if (field === 'route') fixture.candidate.routes = [];
    if (field === 'binding') fixture.candidate.r2_buckets = [];
    expect(() => publishWorker(sha)).toThrow();
    expect(common.command).not.toHaveBeenCalled();
  });
  it('fixes Admin production branch/commit and checks both project and built version first', () => {
    publishAdmin(sha);
    expect(common.command).toHaveBeenCalledExactlyOnceWith('npx', ['wrangler', 'pages', 'deploy', 'apps/web/out', '--project-name', 'synthetic-admin', '--branch', 'main', '--commit-hash', sha, '--commit-message', `production ${sha}`]);
    vi.mocked(common.command).mockClear(); fixture.adminSha = 'b'.repeat(40);
    expect(() => publishAdmin(sha)).toThrow(); expect(common.command).not.toHaveBeenCalled();
    fixture.adminSha = sha; vi.stubEnv('PAGES_PROJECT_NAME', 'wrong');
    expect(() => publishAdmin(sha)).toThrow(); expect(common.command).not.toHaveBeenCalled();
  });
});
