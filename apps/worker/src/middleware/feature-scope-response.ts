import type { Context } from 'hono';
import type { Env } from '../worker-env.js';

export async function appendFeatureScopeMeta(c: Context<Env>, excluded: number): Promise<void> {
  if (excluded < 1 || !c.res.headers.get('content-type')?.includes('application/json')) return;
  try {
    const body = await c.res.clone().json() as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return;
    const meta = body.meta && typeof body.meta === 'object' && !Array.isArray(body.meta)
      ? body.meta as Record<string, unknown>
      : {};
    const headers = new Headers(c.res.headers);
    headers.delete('content-length');
    c.res = new Response(JSON.stringify({
      ...body,
      meta: { ...meta, featureDisabledAccounts: excluded },
    }), { status: c.res.status, headers });
  } catch {
    // JSONでない特殊応答は元のまま返す。
  }
}
