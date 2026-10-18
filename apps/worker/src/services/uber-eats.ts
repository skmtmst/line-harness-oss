/**
 * Uber Eats POS API との通信（デリバリー連携の第1段：Uber Eats）。
 *
 * - この層はDBを触らない。設定とトークンと fetch を受け取り、Uber の応答を型に直して返すだけ。
 * - 認可は2種類あり、公式仕様では権限の種類を混ぜて要求できない。
 *   - 店舗の一覧と連携の有効化：お店の人が認可画面で許す authorization_code（権限 eats.pos_provisioning）。
 *   - 連携済みの店舗との日々のやり取り：client_credentials（権限 eats.store ／ eats.order など）。
 * - 受け取ったトークンは30日で切れる。更新用のトークンは返らない仕様なので、
 *   「更新」は同じ要求でもう一度取り直すこと。
 * - 429 / 5xx / 通信断は指数バックオフで最大3回まで再試行する。401 / 403 は再試行せず種類別の例外にする。
 *   ただしトークンの口は1時間100回までで、取り直すと古いトークンが無効になるため再試行しない。
 * - トークン・秘密値（Application ID・client_secret）をログや例外メッセージに含めない。
 */

// 接続先（Sandbox／本番）と権限の組は uber-eats-hosts.ts が持つ。この層は渡された側へ出す。
import { UBER_OPERATION_SCOPES, UBER_PROVISIONING_SCOPES, type UberHosts } from './uber-eats-hosts.js';
import { boundedHttpRequest } from '../lib/external-call/bounded-http.js';

/** 公式仕様の既定の有効期間（30日）。応答に expires_in が無いときの控え。 */
const DEFAULT_TOKEN_LIFETIME_SECONDS = 2_592_000;

/** 切れる前に取り直す余裕（3日）。30日の有効期間に対して十分前に入れ替える。 */
const RENEW_MARGIN_MS = 3 * 24 * 60 * 60 * 1000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type UberEatsErrorKind =
  | 'auth_expired'
  | 'no_permission'
  | 'rate_limited'
  | 'not_found'
  | 'invalid_request'
  | 'unavailable'
  | 'unknown';

export class UberEatsError extends Error {
  readonly kind: UberEatsErrorKind;
  readonly status: number | null;

  constructor(kind: UberEatsErrorKind, status: number | null, message?: string) {
    super(message ?? `uber_eats_${kind}`);
    this.name = 'UberEatsError';
    this.kind = kind;
    this.status = status;
  }
}

export interface UberOAuthClient {
  clientId: string;
  clientSecret: string;
  /** 認可画面から戻ってくる先。Uber のアプリ登録と完全に同じ文字列でなければならない。 */
  redirectUri: string;
  /** Sandbox と本番のどちら側へ出すか。認証とAPIを必ず同じ側に揃えるため束で持つ。 */
  hosts: UberHosts;
}

export interface UberTokenSet {
  accessToken: string;
  /** 実際に許された権限。要求と違うことがあるので保存して確かめる。 */
  scope: string[];
  expiresAtMs: number;
}

export interface UberStore {
  storeId: string;
  name: string;
  /** 店舗側の管理番号。Uber の案内どおり、これは変わりうるので突き合わせの鍵にしない。 */
  externalStoreId: string | null;
  location: { address: string | null; city: string | null; postalCode: string | null; country: string | null } | null;
}

export interface UberPosData {
  integrationEnabled: boolean;
  integratorStoreId: string | null;
  orderManagerClientId: string | null;
  isOrderManagerPending: boolean;
  onlineStatus: string | null;
}

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  /** 公式仕様では空文字で返る（更新用のトークンは無い）。使わない。 */
  refresh_token?: string;
  error?: string;
}

// ---------- 認可画面への受け渡し ----------

/**
 * 店舗の人に見せる認可画面のURL。
 * state は呼び出し側が作って保存し、戻ってきたときに突き合わせる。
 */
export function buildAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  hosts: UberHosts;
  scopes?: readonly string[];
}): string {
  const url = new URL(input.hosts.authorizeUrl);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', (input.scopes ?? UBER_PROVISIONING_SCOPES).join(' '));
  url.searchParams.set('state', input.state);
  return url.toString();
}

/** 要求した権限が実際に許されたかを確かめる。足りなければ権限不足として止める。 */
export function assertGrantedScopes(granted: readonly string[], required: readonly string[]): void {
  const grantedSet = new Set(granted);
  const missing = required.filter((scope) => !grantedSet.has(scope));
  if (missing.length > 0) {
    throw new UberEatsError('no_permission', null, 'uber_scope_not_granted');
  }
}

// ---------- トークンの取得 ----------

async function postForm(fetchFn: FetchLike, url: string, form: Record<string, string>): Promise<Response> {
  return fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
}

/** エラー本文からは種類の符号だけを取り出す（自由文・秘密値は残さない）。 */
async function readTokenError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as TokenResponse;
    const error = typeof body.error === 'string' ? body.error.trim() : '';
    return /^[a-z0-9_]{1,40}$/.test(error) ? error : `http_${response.status}`;
  } catch {
    return `http_${response.status}`;
  }
}

function tokenSetFrom(payload: TokenResponse, nowMs: number): UberTokenSet {
  if (!payload.access_token) throw new UberEatsError('invalid_request', null, 'uber_token_missing');
  const expiresIn =
    typeof payload.expires_in === 'number' && payload.expires_in > 0 ? payload.expires_in : DEFAULT_TOKEN_LIFETIME_SECONDS;
  return {
    accessToken: payload.access_token,
    scope: (payload.scope ?? '').split(' ').filter(Boolean),
    expiresAtMs: nowMs + expiresIn * 1000,
  };
}

function tokenErrorFor(error: string, status: number): UberEatsError {
  if (error === 'invalid_grant' || error === 'invalid_client') {
    return new UberEatsError('auth_expired', status, `uber_token_${error}`);
  }
  if (error === 'invalid_scope' || error === 'unauthorized_client') {
    return new UberEatsError('no_permission', status, `uber_token_${error}`);
  }
  // トークンの口は1時間100回まで。超えると 429 が返り、古いトークンが無効になる。
  if (status === 429) return new UberEatsError('rate_limited', status, `uber_token_${error}`);
  if (status >= 500) return new UberEatsError('unavailable', status, `uber_token_${error}`);
  return new UberEatsError('invalid_request', status, `uber_token_${error}`);
}

/** 認可画面から戻ってきた1回使い切りの符号を、店舗の代理で使えるトークンに替える。 */
export async function exchangeAuthorizationCode(input: {
  client: UberOAuthClient;
  code: string;
  fetch: FetchLike;
  nowMs?: number;
  requiredScopes?: readonly string[];
}): Promise<UberTokenSet> {
  const response = await postForm(input.fetch, input.client.hosts.tokenUrl, {
    client_id: input.client.clientId,
    client_secret: input.client.clientSecret,
    grant_type: 'authorization_code',
    redirect_uri: input.client.redirectUri,
    code: input.code,
  });
  if (!response.ok) throw tokenErrorFor(await readTokenError(response), response.status);
  const token = tokenSetFrom((await response.json()) as TokenResponse, input.nowMs ?? Date.now());
  assertGrantedScopes(token.scope, input.requiredScopes ?? UBER_PROVISIONING_SCOPES);
  return token;
}

/**
 * 連携済みの店舗を動かすためのトークン。店舗の人の操作は要らない。
 * 更新用のトークンは無いので、切れる前にこれをもう一度呼ぶ。
 */
export async function fetchApplicationToken(input: {
  client: Pick<UberOAuthClient, 'clientId' | 'clientSecret' | 'hosts'>;
  fetch: FetchLike;
  scopes?: readonly string[];
  nowMs?: number;
}): Promise<UberTokenSet> {
  const scopes = input.scopes ?? UBER_OPERATION_SCOPES;
  const response = await postForm(input.fetch, input.client.hosts.tokenUrl, {
    client_id: input.client.clientId,
    client_secret: input.client.clientSecret,
    grant_type: 'client_credentials',
    scope: scopes.join(' '),
  });
  if (!response.ok) throw tokenErrorFor(await readTokenError(response), response.status);
  return tokenSetFrom((await response.json()) as TokenResponse, input.nowMs ?? Date.now());
}

/** 保存したトークンを取り直すべきか（3日前から入れ替える）。 */
export function tokenNeedsRenewal(expiresAtMs: number | null | undefined, nowMs: number): boolean {
  if (!expiresAtMs) return true;
  return expiresAtMs - nowMs <= RENEW_MARGIN_MS;
}

// ---------- 認可付きの呼び出し（再試行あり） ----------

const RETRY_DELAYS_MS = [500, 1500, 4000];

export interface RequestOptions {
  fetch: FetchLike;
  accessToken: string;
  /** 呼ぶ先。トークンを取った側と必ず同じ側にする。 */
  hosts: UberHosts;
  sleep?: (ms: number) => Promise<void>;
  /** Interactive store selection owns the operation; never add SDK retries. */
  singleAttempt?: boolean;
}

function errorFromStatus(status: number): UberEatsError {
  if (status === 401) return new UberEatsError('auth_expired', status);
  if (status === 403) return new UberEatsError('no_permission', status);
  if (status === 404) return new UberEatsError('not_found', status);
  if (status === 429) return new UberEatsError('rate_limited', status);
  if (status >= 500) return new UberEatsError('unavailable', status);
  if (status >= 400) return new UberEatsError('invalid_request', status);
  return new UberEatsError('unknown', status);
}

/**
 * 認可付きの呼び出し。429／5xx／通信断は最大3回まで再試行する。
 * 二重に効いてしまう作成系は retry: false を渡す。
 * Uber の応答本文は読み捨てる（自由文を残さない）。JSON が返る口だけ型に直す。
 */
async function authorizedRequest(
  options: RequestOptions,
  url: string,
  init: { method?: string; body?: unknown; retry?: boolean } = {},
): Promise<Response> {
  const maxAttempts = init.retry === false || options.singleAttempt ? 0 : RETRY_DELAYS_MS.length;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  // Workers の組み込み fetch はメソッドとして呼ぶと this が変わるので、先に取り出す。
  const fetchFn = options.fetch;
  let lastError: UberEatsError | null = null;
  for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
    let response: Response;
    try {
      const request: RequestInit = {
        method: init.method ?? 'GET',
        headers: {
          authorization: `Bearer ${options.accessToken}`,
          accept: 'application/json',
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      };
      response = options.singleAttempt
        ? await boundedHttpRequest(url, request, { timeoutMs: 10_000, maxResponseBytes: 1024 * 1024, fetch: (input, init) => fetchFn(String(input), init) })
        : await fetchFn(url, request);
    } catch {
      lastError = new UberEatsError('unavailable', null, 'uber_network_error');
      if (attempt < maxAttempts) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw lastError;
    }
    if (response.ok) return response;
    lastError = errorFromStatus(response.status);
    const retryable = lastError.kind === 'rate_limited' || lastError.kind === 'unavailable';
    if (retryable && attempt < maxAttempts) {
      await sleep(RETRY_DELAYS_MS[attempt]);
      continue;
    }
    throw lastError;
  }
  throw lastError ?? new UberEatsError('unknown', null);
}

async function authorizedJson<T>(
  options: RequestOptions,
  url: string,
  init: { method?: string; body?: unknown; retry?: boolean } = {},
): Promise<T> {
  const response = await authorizedRequest(options, url, init);
  if (response.status === 204) return {} as T;
  try {
    return (await response.json()) as T;
  } catch {
    throw new UberEatsError('unknown', response.status, 'uber_response_not_json');
  }
}

// ---------- 店舗の一覧 ----------

interface StoresResponse {
  stores?: Array<{
    store_id?: string;
    name?: string;
    external_store_id?: string;
    location?: { address?: string; city?: string; postal_code?: string; country?: string };
  }>;
}

/**
 * 認可した人が管理している店舗の一覧（認可画面のトークンで呼ぶ）。
 * ここで出た店舗を musubo のお店と突き合わせて、どれにつなぐかを選んでもらう。
 */
export async function listStores(options: RequestOptions): Promise<UberStore[]> {
  const body = await authorizedJson<StoresResponse>(options, `${options.hosts.apiBaseUrl}/v1/eats/stores`);
  const stores: UberStore[] = [];
  for (const store of body.stores ?? []) {
    if (!store.store_id) continue;
    stores.push({
      storeId: store.store_id,
      name: store.name?.trim() || store.store_id,
      externalStoreId: store.external_store_id?.trim() || null,
      location: store.location
        ? {
            address: store.location.address?.trim() || null,
            city: store.location.city?.trim() || null,
            postalCode: store.location.postal_code?.trim() || null,
            country: store.location.country?.trim() || null,
          }
        : null,
    });
  }
  return stores;
}

// ---------- 連携の有効化と状態 ----------

function posDataUrl(options: RequestOptions, storeId: string): string {
  return `${options.hosts.apiBaseUrl}/v1/eats/stores/${encodeURIComponent(storeId)}/pos_data`;
}

/**
 * 選ばれた店舗で連携を始める。応答は本文なしの 200。
 * store_configuration_data には個人情報を入れない（公式の注意）。
 */
export async function activatePosIntegration(
  options: RequestOptions,
  storeId: string,
  input: { integratorStoreId?: string; integratorBrandId?: string; isOrderManager?: boolean } = {},
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (input.integratorStoreId) body.integrator_store_id = input.integratorStoreId;
  if (input.integratorBrandId) body.integrator_brand_id = input.integratorBrandId;
  if (input.isOrderManager !== undefined) body.is_order_manager = input.isOrderManager;
  // 二重に送ると連携が重なるので再試行しない。
  await authorizedRequest(options, posDataUrl(options, storeId), { method: 'POST', body, retry: false });
}

interface PosDataResponse {
  integration_enabled?: boolean;
  integrator_store_id?: string;
  order_manager_client_id?: string;
  is_order_manager_pending?: boolean;
  online_status?: string;
}

/** 連携の今の状態。接続の確認（DL-2 の「接続を確かめる」）はこれを読む。 */
export async function fetchPosData(options: RequestOptions, storeId: string): Promise<UberPosData> {
  const body = await authorizedJson<PosDataResponse>(options, posDataUrl(options, storeId));
  return {
    integrationEnabled: body.integration_enabled === true,
    integratorStoreId: body.integrator_store_id?.trim() || null,
    orderManagerClientId: body.order_manager_client_id?.trim() || null,
    isOrderManagerPending: body.is_order_manager_pending === true,
    onlineStatus: body.online_status?.trim() || null,
  };
}

/** 連携を一時的に止める／再開する（店舗の登録自体は残る）。 */
export async function setPosIntegrationEnabled(
  options: RequestOptions,
  storeId: string,
  enabled: boolean,
): Promise<void> {
  await authorizedRequest(options, posDataUrl(options, storeId), {
    method: 'PATCH',
    body: { integration_enabled: enabled },
  });
}

/** 連携を解除する（DL-3 の「連携を解除する」）。 */
export async function deactivatePosIntegration(options: RequestOptions, storeId: string): Promise<void> {
  await authorizedRequest(options, posDataUrl(options, storeId), { method: 'DELETE', retry: false });
}

// ---------- 受信の署名 ----------

/** Uber が付ける見出しの名前。 */
export const UBER_SIGNATURE_HEADER = 'x-uber-signature';

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** 本文の署名（client_secret を鍵にした HMAC-SHA256・小文字16進）。 */
export async function webhookSignatureFor(clientSecret: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(clientSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  return bytesToHex(new Uint8Array(signed));
}

/**
 * 受け取った通知が本物かを確かめる。
 * 署名の鍵は公式仕様どおり client_secret そのもの。合わなければ受け取らない。
 */
export async function verifyWebhookSignature(input: {
  clientSecret: string;
  rawBody: string;
  signature: string | null | undefined;
}): Promise<boolean> {
  const signature = input.signature?.trim().toLowerCase() ?? '';
  if (!signature || !input.clientSecret) return false;
  const expected = await webhookSignatureFor(input.clientSecret, input.rawBody);
  if (expected.length !== signature.length) return false;
  // 文字ごとの比較で早く抜けないようにする（かかった時間から鍵を推し量られないため）。
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  return diff === 0;
}
