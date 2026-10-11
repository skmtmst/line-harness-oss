import { encryptCredential, decryptCredential } from '@line-crm/db';
import type { Env } from '../index.js';
import type { InstagramOAuthPage } from '@line-crm/shared';
import { detectImageMeta } from '../lib/image-validator.js';
export class InstagramError extends Error {
  constructor(
    public code: string,
    public status: 400 | 401 | 403 | 404 | 409 | 422 | 502 | 503 = 502,
    /**
     * Meta が返した失敗の中身（種別・番号・説明）。原因調べのためにサーバー記録へ残すだけで、
     * 画面と応答には出さない（`instagram.onError` は `code` しか返さない）。
     */
    public detail?: string,
  ) {
    super(code);
  }
}
/**
 * Meta が `error.type` に入れてくる種別名。応答の中身は Meta が自由に決められるため、
 * この一覧に載っている名前だけをそのまま使い、載っていない名前は `other` に置き換える。
 * 名前の形（英字だけ等）で見分けるやり方は使わない。たとえば英小文字と数字から成る
 * 32文字の合鍵のような値も「ありそうな形」に当てはまってしまい、守り切れないため。
 */
const META_ERROR_TYPES = new Set([
  'OAuthException',
  'FacebookApiException',
  'GraphMethodException',
  'GraphBatchException',
  'IGApiException',
]);
/** 一覧に無い種別名・検査を通らない値の置き換え先。固定の文言。 */
const OTHER = 'other';
/**
 * `fetch` 自体が失敗したとき（応答が返らなかったとき）の呼び名。
 *
 * - `TimeoutError` … `AbortSignal.timeout` の時間切れ。Meta が遅い／通信が出られない。
 * - `TypeError` … つなげなかった（名前が引けない・接続できない・許していない転送を受けた）。
 * - `AbortError` … 途中で打ち切られた。
 *
 * この呼び名も `Error` の `name` という**応答側の値ではない**が、投げられる中身は
 * 実行環境や上流の都合で変わるため、`error.type` と同じく許可一覧で絞る。
 * 自由文である `message` は読まない。
 */
const FETCH_ERROR_NAMES = new Set([
  'TimeoutError',
  'TypeError',
  'AbortError',
  'DOMException',
  'Error',
]);
/** 投げられた失敗から呼び名だけを取り出す。一覧に無ければ `other`。 */
function fetchErrorName(e: unknown): string {
  const name = (e as { name?: unknown } | null)?.name;
  return typeof name === 'string' && FETCH_ERROR_NAMES.has(name)
    ? name
    : OTHER;
}
/**
 * Meta のエラー本文から、原因調べに使う安全な項目だけを短く取り出す。
 *
 * `error.message` は Meta が書く自由な文章で、要求に渡した値（合鍵・アプリシークレット・
 * 認可コード）がそのまま、あるいは URL エンコード・二重エンコードなど様々な形で混ざって
 * 返ってくる可能性がある。どの形で混ざるかを網羅して消す（伏せ字処理を重ねる）やり方は
 * 新しい表現が見つかるたびに後追いになり守り切れないため、`message` 自体を記録に出さない。
 *
 * `type` / `code` / `subcode` も Meta の応答の一部で、好きな中身を入れられる。
 * そのため「自由な文章ではない項目」という理由だけで通さず、
 * `type` は上の一覧に載る名前だけ、`code` と `subcode` は整数だけに限る。
 * `status` はこちらが受け取った応答の番号で、Meta の本文には由来しない。
 */
async function metaErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as {
      error?: {
        type?: unknown;
        code?: unknown;
        error_subcode?: unknown;
      };
    };
    const e = body?.error;
    if (!e) return undefined;
    const type =
      typeof e.type === 'string' && e.type !== ''
        ? META_ERROR_TYPES.has(e.type)
          ? e.type
          : OTHER
        : '';
    return [
      `status=${response.status}`,
      type ? `type=${type}` : '',
      Number.isInteger(e.code) ? `code=${e.code as number}` : '',
      Number.isInteger(e.error_subcode)
        ? `subcode=${e.error_subcode as number}`
        : '',
    ]
      .filter(Boolean)
      .join(' ');
  } catch {
    // 本文が読めなくても、どの状態で落ちたかだけは残す。
    return `status=${response.status}`;
  }
}
/**
 * 失敗の手がかりを、利用者に見える戻り先URLへ載せてよい形だけに絞り直す。
 *
 * 受け取った文字列をそのまま通さず、こちらが決めた形に合う部分を**組み立て直す**。
 * `metaErrorDetail` で絞ったあとの値を、URLへ出す直前にもう一度ここで確かめることで、
 * 取り出し側の作りが将来変わっても、Meta の応答の中身がURLへ出ない状態を保つ。
 *
 * 通すのは次の5つだけ。
 * - 要求の種別と宛先（`GET v21.0/me/accounts` など。こちらのコードが決める形のみ）
 * - `fetch` … 応答が返らなかったときの呼び名（`FETCH_ERROR_NAMES` の一覧のみ）
 * - `status` … 3桁の数字
 * - `type` … 上の一覧に載る名前（載っていなければ `other`）
 * - `code` / `subcode` … 数字
 */
export function instagramUrlDetail(
  detail: string | null | undefined,
): string | null {
  if (typeof detail !== 'string' || detail.length > 200) return null;
  const parts: string[] = [];
  const step =
    /^(GET|POST|DELETE) (v[0-9]{1,3}\.[0-9]{1,3})\/(me\/accounts|oauth\/access_token|debug_token|[0-9]{1,24}(?:\/[a-z_]{1,24})?)(?= |$)/.exec(
      detail,
    );
  if (step) parts.push(`${step[1]} ${step[2]}/${step[3]}`);
  const fetchError = /(?:^| )fetch=([A-Za-z]{1,40})(?= |$)/.exec(detail);
  if (fetchError)
    parts.push(
      `fetch=${FETCH_ERROR_NAMES.has(fetchError[1]) ? fetchError[1] : OTHER}`,
    );
  const status = /(?:^| )status=([0-9]{3})(?= |$)/.exec(detail);
  if (status) parts.push(`status=${status[1]}`);
  const type = /(?:^| )type=([A-Za-z]{1,40})(?= |$)/.exec(detail);
  if (type)
    parts.push(`type=${META_ERROR_TYPES.has(type[1]) ? type[1] : OTHER}`);
  const code = /(?:^| )code=([0-9]{1,9})(?= |$)/.exec(detail);
  if (code) parts.push(`code=${code[1]}`);
  const subcode = /(?:^| )subcode=([0-9]{1,9})(?= |$)/.exec(detail);
  if (subcode) parts.push(`subcode=${subcode[1]}`);
  return parts.length ? parts.join(' ') : null;
}
/**
 * 失敗の種類名を戻り先URLへ載せてよい形だけに絞る。
 * この値は `InstagramError` を投げるときにこちらのコードが書いた固定の文言で、
 * Meta の応答から入り込む経路が無い。それでも念のため、英小文字と `_` だけの形に限る。
 */
export function instagramUrlCode(code: string | null | undefined): string {
  return typeof code === 'string' && /^[a-z]+(?:_[a-z]+)*$/.test(code)
    ? code
    : OTHER;
}
/**
 * 許可された権限の名前を戻り先URLへ載せてよい形だけに絞る。
 *
 * 名前は Meta の応答（`debug_token` の `scopes`）由来なので、こちらが要求した権限の
 * 一覧に載っている名前だけを通す。形で見分けるやり方は使わない（`META_ERROR_TYPES` と同じ理由）。
 * 一覧に無い名前は中身を出さず、`other2` のように件数だけを添える。
 */
export function instagramUrlScopes(
  scopes: string | null | undefined,
): string | null {
  if (typeof scopes !== 'string' || scopes === '') return null;
  const known: string[] = [];
  let others = 0;
  for (const s of scopes.split(',')) {
    if (s === '') continue;
    if ((INSTAGRAM_SCOPES as readonly string[]).includes(s)) {
      if (!known.includes(s)) known.push(s);
    } else others++;
  }
  if (others) known.push(`${OTHER}${others}`);
  return known.length ? known.join(',') : null;
}
/** 件数は整数だけを通す。整数でなければ `-1` にして、数え損ねたことが分かるようにする。 */
export function instagramUrlCount(n: unknown): number {
  return Number.isInteger(n) && (n as number) >= 0 ? (n as number) : -1;
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
  } catch (e) {
    // 応答が返らなかった場合。どの要求で止まったかと呼び名だけを残す。
    // これが無いと「つながらなかった」ことしか分からず、時間切れと接続不可を見分けられない。
    throw new InstagramError(
      'meta_unavailable',
      502,
      `${method} ${config.version}/${path} fetch=${fetchErrorName(e)}`,
    );
  }
  if (!response.ok)
    throw new InstagramError(
      response.status === 401 || response.status === 403
        ? 'meta_authorization_failed'
        : 'meta_request_failed',
      502,
      `${method} ${config.version}/${path} ${await metaErrorDetail(response)}`,
    );
  return response.json() as Promise<T>;
}
export type InstagramPage = InstagramOAuthPage & { token: string };
/** 原因調べ用の数えだけを受け取る入れもの。ページ名やIDなどの中身は入れない。 */
export type InstagramPageScan = {
  /** me/accounts が返したページの数 */
  total: number;
  /** そのうち Instagram のビジネスアカウントがつながっていた数 */
  withInstagram: number;
  /** そのうちページの合鍵も一緒に返ってきた数 */
  withToken: number;
};
export async function instagramPages(
  config: InstagramConfig,
  userToken: string,
  scan?: InstagramPageScan,
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
    for (const p of r.data ?? []) {
      if (scan) {
        scan.total++;
        if (/^\d+$/.test(p.instagram_business_account?.id ?? ''))
          scan.withInstagram++;
        if (p.access_token) scan.withToken++;
      }
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
    }
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
  /** 利用者が実際に許可した範囲。instagram_content_publish が無ければ同時投稿はできない。 */
  scopes: string[];
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
      scopes?: string[];
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
    scopes: Array.isArray(debug.data.scopes)
      ? debug.data.scopes.filter((s) => typeof s === 'string' && s !== '')
      : [],
  };
}
/**
 * 接続のときに要求する権限の一覧（認可画面へ渡す順そのまま）。
 * 戻り先URLへ載せてよい権限名の許可一覧も、この定義を正本として使う。
 */
export const INSTAGRAM_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'instagram_basic',
  'instagram_manage_messages',
  'instagram_content_publish',
] as const;
/** 同時投稿に必要な許可。足りない接続は画面で「認可が切れています」にして再接続へ誘導する。 */
export const INSTAGRAM_PUBLISH_SCOPE = 'instagram_content_publish';
export function instagramCanPublish(scopes: string): boolean {
  return scopes.split(',').includes(INSTAGRAM_PUBLISH_SCOPE);
}
/**
 * 写真つき投稿を Instagram へ出す（GB-4 の同時投稿）。
 * Meta は画像を自分で取りに来るため imageUrl は公開URLでなければならない。
 * コンテナを作ってから公開する2段で、1段目で落ちたときは公開していない。
 */
export async function instagramPublish(
  config: InstagramConfig,
  instagramId: string,
  pageToken: string,
  input: { imageUrl: string; caption: string },
): Promise<{ mediaId: string; permalink: string | null }> {
  const container = await instagramGraph<{ id?: string }>(
    config,
    `${instagramId}/media`,
    pageToken,
    { image_url: input.imageUrl, caption: input.caption },
    'POST',
  );
  if (!container.id) throw new InstagramError('meta_request_failed');
  const published = await instagramGraph<{ id?: string }>(
    config,
    `${instagramId}/media_publish`,
    pageToken,
    { creation_id: container.id },
    'POST',
  );
  if (!published.id) throw new InstagramError('meta_request_failed');
  // 投稿自体は済んでいるので、見に行く先の取得だけ失敗しても成功として扱う。
  let permalink: string | null = null;
  try {
    const detail = await instagramGraph<{ permalink?: string }>(
      config,
      published.id,
      pageToken,
      { fields: 'permalink' },
    );
    permalink = detail.permalink ?? null;
  } catch {
    permalink = null;
  }
  return { mediaId: published.id, permalink };
}
/** Instagram は JPEG しか受け取らないうえ、容量は8MBまで。 */
const INSTAGRAM_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
/**
 * 登録メディアの画像を Instagram が取りに来られる JPEG の公開URLにする。
 * すでに JPEG なら元のURLをそのまま使い、PNG のときだけ変換して置き直す。
 * 元ファイルは読むだけで、変換結果は別のキーに入れる。
 */
export async function instagramImageUrl(
  env: Env['Bindings'],
  input: { r2Key: string; sourceUrl: string; origin: string },
): Promise<string> {
  const object = await env.IMAGES.get(input.r2Key);
  if (!object) throw new InstagramError('instagram_image_unavailable', 422);
  const bytes = new Uint8Array(await object.arrayBuffer());
  const meta = detectImageMeta(bytes);
  if (!meta) throw new InstagramError('instagram_image_unsupported', 422);
  if (meta.format === 'jpeg') {
    if (bytes.byteLength > INSTAGRAM_IMAGE_MAX_BYTES)
      throw new InstagramError('instagram_image_too_large', 422);
    return input.sourceUrl;
  }
  if (!env.CF_IMAGES) throw new InstagramError('instagram_images_unconfigured', 503);
  const output = await env.CF_IMAGES.input(new Blob([bytes]).stream())
    .transform({ width: Math.min(meta.width, 1440) })
    .output({ format: 'image/jpeg' });
  const converted = await new Response(output.image()).arrayBuffer();
  if (!converted.byteLength || converted.byteLength > INSTAGRAM_IMAGE_MAX_BYTES)
    throw new InstagramError('instagram_image_too_large', 422);
  const key = `instagram-jpeg/${crypto.randomUUID()}.jpg`;
  await env.IMAGES.put(key, converted, {
    httpMetadata: { contentType: 'image/jpeg' },
  });
  return `${input.origin.replace(/\/+$/, '')}/images/${key}`;
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
