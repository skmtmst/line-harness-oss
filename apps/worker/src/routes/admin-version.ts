import { tracedFetch as fetch } from '@line-crm/shared/server';
import { Hono } from 'hono';
import {
  WORKER_HASH,
  ADMIN_HASH,
  LIFF_HASH,
} from '../release-version.js';
import { buildMetadata, type BuildBindings } from '../lib/build-metadata.js';

const DEFAULT_MANIFEST_URL =
  'https://github.com/Shudesu/line-harness-oss/releases/latest/download/release-manifest.json';

type Env = {
  Bindings: BuildBindings & {
    MANIFEST_URL?: string;
    DEPLOY_ENV?: string;
  };
};

// ログイン前の更新案内でも使うため、ビルド時の公開情報は未認証で返す。GitHub の公開成果物は CORS が安定しないため manifest を中継する。更新操作の停止とは独立に扱う。
const app = new Hono<Env>();

/*
 * 監査 m18e: どのコードが動いているか分かるように、版・commit・配備日時・
 * 環境を返す。DEPLOY_ENV は wrangler の staging/production の設定が持つ
 * （`wrangler.staging.toml` / `wrangler.toml` の [vars]）。未設定なら null。
 */
app.get('/version', (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json({
    ...buildMetadata(c.env),
    worker_hash: WORKER_HASH,
    admin_hash: ADMIN_HASH,
    liff_hash: LIFF_HASH,
    deploy_env: c.env?.DEPLOY_ENV ?? null,
  });
});

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
