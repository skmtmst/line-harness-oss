import { encryptCredential, decryptCredential } from '@line-crm/db';
import type { Env } from '../index.js';
import type { InstagramOAuthPage } from '@line-crm/shared';
export class InstagramError extends Error {
  constructor(
    public code: string,
    public status: 400 | 401 | 403 | 404 | 409 | 422 | 502 | 503 = 502,
  ) {
    super(code);
  }
}
export type InstagramConfig = {
  appId: string;
  appSecret: string;
  redirectUri: string;
  version: string;
  encryptionKey: string;
};
export function instagramConfig(env: Env['Bindings']): InstagramConfig | null {
  const {
    META_APP_ID: appId,
    META_APP_SECRET: appSecret,
    META_REDIRECT_URI: redirectUri,
    META_GRAPH_API_VERSION: version,
    META_TOKEN_ENCRYPTION_KEY: encryptionKey,
  } = env;
  if (
    !appId ||
    !appSecret ||
    !redirectUri ||
    !version ||
    !encryptionKey ||
    !/^v\d+\.\d+$/.test(version)
  )
    return null;
  try {
    const key = encryptionKey.trim().replace(/-/g, '+').replace(/_/g, '/');
    if (atob(key.padEnd(Math.ceil(key.length / 4) * 4, '=')).length !== 32)
      return null;
    const u = new URL(redirectUri);
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      u.search ||
      u.hash
    )
      return null;
  } catch {
    return null;
  }
  return { appId, appSecret, redirectUri, version, encryptionKey };
}
export async function instagramHash(s: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(s),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
export async function instagramGraph<T>(
  config: InstagramConfig,
  path: string,
  token: string | null,
  query: Record<string, string> = {},
  method = 'GET',
): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${config.version}/${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new InstagramError('meta_unavailable');
  }
  if (!response.ok)
    throw new InstagramError(
      response.status === 401 || response.status === 403
        ? 'meta_authorization_failed'
        : 'meta_request_failed',
    );
  return response.json() as Promise<T>;
}
export type InstagramPage = InstagramOAuthPage & { token: string };
export async function instagramPages(
  config: InstagramConfig,
  userToken: string,
): Promise<InstagramPage[]> {
  const pages: InstagramPage[] = [];
  let after: string | undefined;
  for (let n = 0; n < 20; n++) {
    const r = await instagramGraph<{
      data: Array<{
        id: string;
        name: string;
        access_token: string;
        instagram_business_account?: { id: string };
      }>;
      paging?: { cursors?: { after?: string }; next?: string };
    }>(config, 'me/accounts', userToken, {
      fields: 'id,name,access_token,instagram_business_account',
      limit: '100',
      ...(after ? { after } : {}),
    });
    for (const p of r.data ?? [])
      if (
        /^\d+$/.test(p.id) &&
        /^\d+$/.test(p.instagram_business_account?.id ?? '') &&
        p.access_token
      )
        pages.push({
          pageId: p.id,
          pageName: p.name,
          instagramId: p.instagram_business_account!.id,
          token: p.access_token,
        });
    if (!r.paging?.next) return pages;
    if (!r.paging.cursors?.after || r.paging.cursors.after === after)
      throw new InstagramError('meta_pagination_failed');
    after = r.paging.cursors.after;
  }
  throw new InstagramError('too_many_meta_pages');
}
export async function instagramLongToken(
  config: InstagramConfig,
  token: string,
): Promise<{
  token: string;
  expiresAt: string;
  dataAccessExpiresAt: string | null;
}> {
  const r = await instagramGraph<{ access_token: string; expires_in?: number }>(
    config,
    'oauth/access_token',
    null,
    {
      grant_type: 'fb_exchange_token',
      client_id: config.appId,
      client_secret: config.appSecret,
      fb_exchange_token: token,
    },
  );
  if (!r.access_token) throw new InstagramError('invalid_meta_token');
  const debug = await instagramGraph<{
    data: {
      is_valid: boolean;
      app_id: string;
      expires_at?: number;
      data_access_expires_at?: number;
    };
  }>(config, 'debug_token', `${config.appId}|${config.appSecret}`, {
    input_token: r.access_token,
  });
  if (!debug.data?.is_valid || String(debug.data.app_id) !== config.appId)
    throw new InstagramError('invalid_meta_token');
  const expires =
    debug.data.expires_at ||
    (r.expires_in ? Math.floor(Date.now() / 1000) + r.expires_in : 0);
  if (
    !expires ||
    expires <= Date.now() / 1000 ||
    (debug.data.data_access_expires_at &&
      debug.data.data_access_expires_at <= Date.now() / 1000)
  )
    throw new InstagramError('meta_token_expired', 409);
  return {
    token: r.access_token,
    expiresAt: new Date(expires * 1000).toISOString(),
    dataAccessExpiresAt: debug.data.data_access_expires_at
      ? new Date(debug.data.data_access_expires_at * 1000).toISOString()
      : null,
  };
}
export {
  encryptCredential as encryptInstagramCredential,
  decryptCredential as decryptInstagramCredential,
};
export async function verifyInstagramSignature(
  raw: string,
  header: string | undefined,
  secret: string,
): Promise<boolean> {
  if (!header || !/^sha256=[a-f0-9]{64}$/i.test(header)) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const sig = Uint8Array.from(header.slice(7).match(/../g)!, (p) =>
    parseInt(p, 16),
  );
  return crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(raw));
}
export async function purgeInstagramTransientData(
  db: D1Database,
  now = new Date(),
): Promise<void> {
  await db.batch([
    db
      .prepare('DELETE FROM instagram_oauth_states WHERE expires_at<=?')
      .bind(now.toISOString()),
    db
      .prepare('DELETE FROM instagram_messages WHERE created_at<?')
      .bind(new Date(now.getTime() - 90 * 86400000).toISOString()),
  ]);
}
