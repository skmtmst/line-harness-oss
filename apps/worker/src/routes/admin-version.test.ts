import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import adminVersion from './admin-version.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /admin/version', () => {
  it('returns version + hashes', async () => {
    const app = new Hono();
    app.route('/admin', adminVersion);
    const res = await app.request('/admin/version');
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      version: string;
      worker_hash: string;
      admin_hash: string;
      liff_hash: string;
      released_at: string;
      git_commit: string;
      deploy_env: string | null;
    };
    expect(j.version).toMatch(/^\d+\.\d+\.\d+(-\w+)?$/);
    expect(j.worker_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(j.admin_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(j.liff_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(j.released_at).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(typeof j.git_commit).toBe('string');
  });

  it('returns the deploy env from wrangler vars (null when unset)', async () => {
    const app = new Hono();
    app.route('/admin', adminVersion);
    const withEnv = await app.request('/admin/version', {}, { DEPLOY_ENV: 'staging' });
    expect(withEnv.status).toBe(200);
    const staged = (await withEnv.json()) as { deploy_env: string | null };
    expect(staged.deploy_env).toBe('staging');

    const bare = await app.request('/admin/version');
    const unset = (await bare.json()) as { deploy_env: string | null };
    expect(unset.deploy_env).toBeNull();
  });
});

describe('GET /admin/manifest', () => {
  it('proxies the release manifest with browser-readable headers', async () => {
    const manifest = { schema_version: 1, latest: '0.14.1', releases: [] };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(manifest), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const app = new Hono();
    app.route('/admin', adminVersion);
    const res = await app.request('/admin/manifest', {}, {
      MANIFEST_URL: 'https://example.com/release-manifest.json',
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
    expect(await res.json()).toEqual(manifest);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/release-manifest.json',
      { cf: { cacheTtl: 60, cacheEverything: true } },
    );
  });

  it('returns 502 when the upstream manifest cannot be fetched', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 404 }));

    const app = new Hono();
    app.route('/admin', adminVersion);
    const res = await app.request('/admin/manifest');

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'manifest_fetch_failed' });
  });
});
