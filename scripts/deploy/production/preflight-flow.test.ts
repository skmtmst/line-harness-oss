import { afterEach, describe, expect, it, vi } from 'vitest';
import { unstable_readConfig } from 'wrangler';
import * as common from './common.js';
import { preflight } from './preflight.js';
const sha = 'a'.repeat(40), main = 'b'.repeat(40), repository = 'owner/repository';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
function fixture(failure = '') {
  for (const [name, value] of Object.entries({ SECURITY_WORKER_NAME: unstable_readConfig({config: 'apps/worker/wrangler.toml'}).name, PAGES_PROJECT_NAME: unstable_readConfig({config: 'apps/worker/wrangler.toml'}).vars.ADMIN_PAGES_PROJECT, NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'synthetic-site-key', OPERATIONS_PAUSED: 'true', GITHUB_REPOSITORY: repository, GITHUB_SHA: main, GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/deploy-cloudflare-production.yml@refs/heads/main`, GH_TOKEN: 'synthetic-token' })) vi.stubEnv(name, value);
  vi.spyOn(common, 'command').mockImplementation((_binary, args) => {
    if (args.includes('FETCH_HEAD')) return main;
    if (args.includes('HEAD')) return sha;
    if (args.some(arg => arg.endsWith('^{tree}'))) return 'identical-tree';
    return '';
  });
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(init?.redirect).toBe('error');
    if (url.hostname === 'api.github.com') {
      if (failure === 'metadata') return new Response('synthetic-provider-secret', { status: 403 });
      if (url.pathname.endsWith('/environments/production')) return Response.json({ protection_rules: failure === 'reviewers' ? [] : [{ type: 'required_reviewers', reviewers: [{ type: 'User' }] }] });
      if (url.pathname.endsWith('/jobs')) return Response.json({ jobs: [{ conclusion: 'success', steps: [{ name: 'Verify public source revisions', conclusion: failure === 'skipped' ? 'skipped' : 'success' }] }] });
      return Response.json({ repository: { full_name: repository }, head_repository: { full_name: repository }, head_sha: failure === 'run-sha' ? main : sha, status: 'completed', conclusion: 'success', event: 'workflow_dispatch', path: '.github/workflows/deploy-cloudflare-staging.yml' });
    }
    // No credentials, cookies or request body may reach the public probes.
    expect(init).not.toHaveProperty('headers'); expect(init).not.toHaveProperty('body');
    expect(url.hostname).toMatch(/^stg-(?:api|admin)\.musubo\.jp$/);
    const git_commit = failure === 'public-sha' && url.hostname.startsWith('stg-admin') ? main : sha;
    return Response.json(url.pathname === '/api/health' ? { success: true, data: { status: 'ok', git_commit } } : { git_commit });
  });
  return fetcher;
}
describe('release preflight uses real orchestration with synthetic metadata', () => {
  it('verifies the main tree, protected environment, staging run, Worker version/health and Admin version', async () => {
    const fetcher = fixture();
    await preflight(sha, '123', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(vi.mocked(common.command).mock.calls.some(([, args]) => args.includes('--is-ancestor'))).toBe(true);
  });
  it('fails before DB work when Admin public configuration is missing or points to another project', async () => {
    const fetcher = fixture(); vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '');
    await expect(preflight(sha, '123', fetcher)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'synthetic-site-key'); vi.stubEnv('PAGES_PROJECT_NAME', 'wrong');
    await expect(preflight(sha, '123', fetcher)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['', 'wrong-worker'])('rejects missing/mismatched Worker identity %s before DB work or provider requests', async worker => {
    const fetcher = fixture(); vi.stubEnv('SECURITY_WORKER_NAME', worker);
    await expect(preflight(sha, '123', fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('requires the operator pause confirmation without changing operational flags', async () => {
    const fetcher = fixture(); vi.stubEnv('OPERATIONS_PAUSED', 'false');
    await expect(preflight(sha, '123', fetcher)).rejects.toThrow('operations_pause_confirmation');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['metadata', 'reviewers', 'skipped', 'run-sha', 'public-sha'])('does not accept %s as staging evidence', async failure => {
    const fetcher = fixture(failure);
    await expect(preflight(sha, '123', fetcher)).rejects.toThrow();
    expect(vi.mocked(common.command).mock.calls.every(([binary]) => binary === 'git')).toBe(true);
  });
});
