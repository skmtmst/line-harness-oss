import { decryptCredential, encryptCredential } from '@line-crm/db';
import { boundedHttpRequest } from '../../lib/external-call/bounded-http.js';
import {
  UberEatsError,
  assertGrantedScopes,
  fetchApplicationToken,
  type FetchLike,
  type UberOAuthClient,
  type UberTokenSet,
} from '../../services/uber-eats.js';

const REQUIRED_SCOPES = ['eats.order', 'eats.store.orders.read'] as const;
const CACHE_PREFIX = 'uber-application-token:v1:';
const REFRESH_LOCK_PREFIX = 'uber-application-token-refresh:v1:';
const FAILURE_LOCK_PREFIX = 'uber-application-token-failure:v1:';
const REFRESH_LEASE_MS = 15_000;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_TOKEN_RESPONSE_BYTES = 16 * 1024;
const FAILURE_COOLDOWN_MS = 30_000;
const RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;

interface CachedTokenRow {
  access_token_enc: string;
  access_token_expires_at: number;
  granted_scope: string | null;
  updated_at: number;
}

interface LockRow {
  owner_token: string;
  expires_at: string;
}

interface ValidTokenResponse {
  accessToken: string;
  expiresInSeconds: number;
  scope: string[];
}

function fixedError(message: string): UberEatsError {
  return new UberEatsError('unavailable', null, message);
}

function invalidResponseError(): UberEatsError {
  return new UberEatsError('invalid_request', null, 'uber_application_token_invalid_response');
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function scopeList(value: string | null): string[] {
  return (value ?? '').split(/\s+/).filter(Boolean);
}

function cacheSkewMs(createdAtMs: number, expiresAtMs: number): number {
  const lifetimeMs = Math.max(0, expiresAtMs - createdAtMs);
  return Math.min(60_000, Math.max(0, Math.floor(lifetimeMs / 10)), Math.floor(lifetimeMs / 2));
}

function isUsable(row: CachedTokenRow, nowMs: number): boolean {
  if (!Number.isSafeInteger(row.access_token_expires_at) || !Number.isSafeInteger(row.updated_at)) return false;
  if (row.access_token_expires_at <= row.updated_at) return false;
  return row.access_token_expires_at - nowMs > cacheSkewMs(row.updated_at, row.access_token_expires_at);
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function cacheIdentity(input: {
  client: Pick<UberOAuthClient, 'clientId' | 'clientSecret' | 'hosts'>;
  encryptionKey: string;
}): Promise<string> {
  const material = JSON.stringify({
    version: 1,
    hosts: input.client.hosts,
    clientId: input.client.clientId,
    clientSecret: input.client.clientSecret,
    encryptionKey: input.encryptionKey,
    scopes: [...REQUIRED_SCOPES].sort(),
  });
  return sha256Hex(material);
}

async function readCachedToken(input: {
  db: D1Database;
  cacheId: string;
  encryptionKey: string;
  nowMs: number;
}): Promise<UberTokenSet | null> {
  const row = await input.db
    .prepare(
      `SELECT access_token_enc, access_token_expires_at, granted_scope, updated_at
         FROM rt_delivery_uber_app_tokens
        WHERE id = ?
        LIMIT 1`,
    )
    .bind(input.cacheId)
    .first<CachedTokenRow>();
  if (!row || !isUsable(row, input.nowMs)) return null;
  const scope = scopeList(row.granted_scope);
  try {
    assertGrantedScopes(scope, REQUIRED_SCOPES);
  } catch {
    return null;
  }
  try {
    return {
      accessToken: await decryptCredential(row.access_token_enc, input.encryptionKey),
      scope,
      expiresAtMs: row.access_token_expires_at,
    };
  } catch {
    throw fixedError('uber_application_token_cache_invalid');
  }
}

async function activeFailureCooldown(db: D1Database, resourceKey: string, nowMs: number): Promise<boolean> {
  const row = await db
    .prepare('SELECT owner_token, expires_at FROM rt_resource_locks WHERE resource_key = ? LIMIT 1')
    .bind(resourceKey)
    .first<LockRow>();
  if (!row) return false;
  const expiresAtMs = Date.parse(row.expires_at);
  return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
}

async function acquireRefreshLock(input: {
  db: D1Database;
  resourceKey: string;
  ownerToken: string;
  nowMs: number;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `INSERT INTO rt_resource_locks (resource_key, owner_token, expires_at, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(resource_key) DO UPDATE SET
         owner_token = excluded.owner_token,
         expires_at = excluded.expires_at,
         created_at = excluded.created_at
       WHERE julianday(rt_resource_locks.expires_at) <= julianday(?)`,
    )
    .bind(
      input.resourceKey,
      input.ownerToken,
      iso(input.nowMs + REFRESH_LEASE_MS),
      iso(input.nowMs),
      iso(input.nowMs),
    )
    .run();
  return (result.meta.changes ?? 0) === 1;
}

async function releaseRefreshLock(db: D1Database, resourceKey: string, ownerToken: string): Promise<void> {
  await db
    .prepare('DELETE FROM rt_resource_locks WHERE resource_key = ? AND owner_token = ?')
    .bind(resourceKey, ownerToken)
    .run();
}

function cooldownFor(error: unknown): number {
  return error instanceof UberEatsError && error.kind === 'rate_limited'
    ? RATE_LIMIT_COOLDOWN_MS
    : FAILURE_COOLDOWN_MS;
}

async function retainFailureCooldownAndRelease(input: {
  db: D1Database;
  refreshKey: string;
  failureKey: string;
  ownerToken: string;
  nowMs: number;
  cooldownMs: number;
}): Promise<void> {
  await input.db.batch([
    input.db
      .prepare(
        `INSERT INTO rt_resource_locks (resource_key, owner_token, expires_at, created_at)
         SELECT ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM rt_resource_locks
             WHERE resource_key = ? AND owner_token = ?
          )
         ON CONFLICT(resource_key) DO UPDATE SET
           owner_token = CASE
             WHEN julianday(excluded.expires_at) > julianday(rt_resource_locks.expires_at)
             THEN excluded.owner_token ELSE rt_resource_locks.owner_token END,
           expires_at = CASE
             WHEN julianday(excluded.expires_at) > julianday(rt_resource_locks.expires_at)
             THEN excluded.expires_at ELSE rt_resource_locks.expires_at END,
           created_at = CASE
             WHEN julianday(excluded.expires_at) > julianday(rt_resource_locks.expires_at)
             THEN excluded.created_at ELSE rt_resource_locks.created_at END`,
      )
      .bind(
        input.failureKey,
        input.ownerToken,
        iso(input.nowMs + input.cooldownMs),
        iso(input.nowMs),
        input.refreshKey,
        input.ownerToken,
      ),
    input.db
      .prepare('DELETE FROM rt_resource_locks WHERE resource_key = ? AND owner_token = ?')
      .bind(input.refreshKey, input.ownerToken),
  ]);
}

function validateTokenPayload(payload: unknown): ValidTokenResponse {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw invalidResponseError();
  }
  const record = payload as Record<string, unknown>;
  const accessToken = typeof record.access_token === 'string' ? record.access_token.trim() : '';
  const expiresInSeconds = record.expires_in;
  if (
    !accessToken ||
    typeof expiresInSeconds !== 'number' ||
    !Number.isSafeInteger(expiresInSeconds) ||
    expiresInSeconds <= 0 ||
    typeof record.scope !== 'string'
  ) {
    throw invalidResponseError();
  }
  const scope = scopeList(record.scope);
  assertGrantedScopes(scope, REQUIRED_SCOPES);
  return { accessToken, expiresInSeconds, scope };
}

async function requestApplicationToken(input: {
  client: Pick<UberOAuthClient, 'clientId' | 'clientSecret' | 'hosts'>;
  fetcher: FetchLike;
  nowMs: number;
}): Promise<UberTokenSet> {
  const observed: { token?: ValidTokenResponse } = {};
  const boundedFetch: FetchLike = async (url, init) => {
    const response = await boundedHttpRequest(url, init ?? {}, {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxResponseBytes: MAX_TOKEN_RESPONSE_BYTES,
      fetch: (request, requestInit) => input.fetcher(String(request), requestInit),
    });
    if (response.ok) {
      let payload: unknown;
      try {
        payload = await response.clone().json();
      } catch {
        throw invalidResponseError();
      }
      observed.token = validateTokenPayload(payload);
    }
    return response;
  };

  let token: UberTokenSet;
  try {
    token = await fetchApplicationToken({
      client: input.client,
      fetch: boundedFetch,
      scopes: REQUIRED_SCOPES,
      nowMs: input.nowMs,
    });
  } catch (error) {
    if (error instanceof UberEatsError) {
      if (error.message === 'uber_application_token_invalid_response') throw error;
      throw new UberEatsError(
        error.kind,
        error.status,
        `uber_application_token_${error.kind}`,
      );
    }
    throw fixedError('uber_application_token_unavailable');
  }
  const validated = observed.token;
  if (!validated) throw invalidResponseError();
  assertGrantedScopes(token.scope, REQUIRED_SCOPES);
  if (
    token.accessToken !== validated.accessToken ||
    token.expiresAtMs !== input.nowMs + validated.expiresInSeconds * 1000 ||
    !Number.isSafeInteger(token.expiresAtMs)
  ) {
    throw invalidResponseError();
  }
  return token;
}

async function persistTokenIfOwner(input: {
  db: D1Database;
  cacheId: string;
  refreshKey: string;
  ownerToken: string;
  encryptedToken: string;
  token: UberTokenSet;
  nowMs: number;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `INSERT INTO rt_delivery_uber_app_tokens
         (id, access_token_enc, access_token_expires_at, granted_scope, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM rt_resource_locks
           WHERE resource_key = ?
             AND owner_token = ?
             AND julianday(expires_at) > julianday(?)
        )
       ON CONFLICT(id) DO UPDATE SET
         access_token_enc = excluded.access_token_enc,
         access_token_expires_at = excluded.access_token_expires_at,
         granted_scope = excluded.granted_scope,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at
       WHERE EXISTS (
         SELECT 1 FROM rt_resource_locks
          WHERE resource_key = ?
            AND owner_token = ?
            AND julianday(expires_at) > julianday(?)
       )
       RETURNING id`,
    )
    .bind(
      input.cacheId,
      input.encryptedToken,
      input.token.expiresAtMs,
      input.token.scope.join(' '),
      input.nowMs,
      input.nowMs,
      input.refreshKey,
      input.ownerToken,
      iso(input.nowMs),
      input.refreshKey,
      input.ownerToken,
      iso(input.nowMs),
    )
    .all<{ id: string }>();
  return result.results.length === 1;
}

/**
 * 注文の受け取りに使うアプリ単位のトークンを、安全に使い回す。
 * 呼び出しごとの状態はD1へ置き、Workerのモジュール全体には保持しない。
 */
export async function getUberApplicationToken(input: {
  db: D1Database;
  client: Pick<UberOAuthClient, 'clientId' | 'clientSecret' | 'hosts'>;
  encryptionKey: string | undefined;
  fetcher: FetchLike;
  nowMs?: number;
}): Promise<UberTokenSet> {
  const nowMs = input.nowMs ?? Date.now();
  const wallClockStartedAtMs = Date.now();
  const elapsedNowMs = () => nowMs + Math.max(0, Date.now() - wallClockStartedAtMs);

  // 鍵が無い・形式が違う場合は、外部へ秘密値を送る前に既存の暗号処理で止める。
  await encryptCredential('uber_application_token_key_check', input.encryptionKey);
  const encryptionKey = input.encryptionKey!.trim();
  const identity = await cacheIdentity({ client: input.client, encryptionKey });
  const cacheId = `${CACHE_PREFIX}${identity}`;
  const refreshKey = `${REFRESH_LOCK_PREFIX}${identity}`;
  const failureKey = `${FAILURE_LOCK_PREFIX}${identity}`;

  const cached = await readCachedToken({ db: input.db, cacheId, encryptionKey, nowMs });
  if (cached) return cached;
  if (await activeFailureCooldown(input.db, failureKey, nowMs)) {
    throw fixedError('uber_application_token_cooldown');
  }

  const ownerToken = crypto.randomUUID();
  const acquired = await acquireRefreshLock({ db: input.db, resourceKey: refreshKey, ownerToken, nowMs });
  if (!acquired) throw fixedError('uber_application_token_busy');

  let tokenRequestStarted = false;
  try {
    // 排他を取る前に別の実行主体が保存している場合は、その値を使う。
    const afterLock = await readCachedToken({ db: input.db, cacheId, encryptionKey, nowMs: elapsedNowMs() });
    if (afterLock) {
      await releaseRefreshLock(input.db, refreshKey, ownerToken);
      return afterLock;
    }
    // 冷却の確認とリース取得の間に、先行の失敗が冷却を残す競合もここで塞ぐ。
    if (await activeFailureCooldown(input.db, failureKey, elapsedNowMs())) {
      throw fixedError('uber_application_token_cooldown');
    }

    tokenRequestStarted = true;
    const token = await requestApplicationToken({
      client: input.client,
      fetcher: input.fetcher,
      nowMs,
    });
    const encryptedToken = await encryptCredential(token.accessToken, encryptionKey);
    const persistenceNowMs = elapsedNowMs();
    if (token.expiresAtMs <= persistenceNowMs) throw invalidResponseError();
    const persisted = await persistTokenIfOwner({
      db: input.db,
      cacheId,
      refreshKey,
      ownerToken,
      encryptedToken,
      token,
      nowMs: persistenceNowMs,
    });
    if (!persisted) throw fixedError('uber_application_token_busy');
    if (token.expiresAtMs <= elapsedNowMs()) throw invalidResponseError();
    await releaseRefreshLock(input.db, refreshKey, ownerToken);
    return token;
  } catch (error) {
    if (tokenRequestStarted) {
      try {
        await retainFailureCooldownAndRelease({
          db: input.db,
          refreshKey,
          failureKey,
          ownerToken,
          nowMs: elapsedNowMs(),
          cooldownMs: cooldownFor(error),
        });
      } catch {
        // D1が失敗しても、元の分類済みの失敗を秘密値のない形で返す。
      }
    } else {
      try {
        await releaseRefreshLock(input.db, refreshKey, ownerToken);
      } catch {
        // 元の失敗を優先する。リースは短時間で失効する。
      }
    }
    if (error instanceof UberEatsError) throw error;
    throw fixedError('uber_application_token_unavailable');
  }
}
