import { Hono } from 'hono';
import {
  BUNDLE_VERSION,
  WORKER_HASH,
  ADMIN_HASH,
  LIFF_HASH,
  RELEASED_AT,
  GIT_COMMIT,
} from '../_version.js';

const DEFAULT_MANIFEST_URL =
  'https://github.com/Shudesu/line-harness-oss/releases/latest/download/release-manifest.json';

type Env = {
  Bindings: {
    MANIFEST_URL?: string;
    DEPLOY_ENV?: string;
  };
};

// Unauthenticated by design — returns build-time public metadata used by the
// dashboard's upgrade banner before the user logs in. The manifest proxy exists
// because GitHub release assets do not reliably send browser CORS headers.
// Task 18's /admin/update/* mounts under the same /admin prefix but layers
// ADMIN_API_KEY middleware on those subpaths.
const app = new Hono<Env>();

/*
 * 監査 m18e: どのコードが動いているか分かるように、版・commit・配備日時・
 * 環境を返す。DEPLOY_ENV は wrangler の staging/production の設定が持つ
 * （`wrangler.staging.toml` / `wrangler.toml` の [vars]）。未設定なら null。
 */
app.get('/version', (c) =>
  c.json({
    version: BUNDLE_VERSION,
    worker_hash: WORKER_HASH,
    admin_hash: ADMIN_HASH,
    liff_hash: LIFF_HASH,
    released_at: RELEASED_AT,
    git_commit: GIT_COMMIT,
    deploy_env: c.env?.DEPLOY_ENV ?? null,
  }),
);

app.get('/manifest', async (c) => {
  const manifestUrl = c.env?.MANIFEST_URL ?? DEFAULT_MANIFEST_URL;
  const upstream = await fetch(manifestUrl, {
    cf: { cacheTtl: 60, cacheEverything: true },
  });

  if (!upstream.ok) {
    return c.json({ error: 'manifest_fetch_failed' }, 502);
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type':
        upstream.headers.get('Content-Type') ?? 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
    },
  });
});

export default app;
