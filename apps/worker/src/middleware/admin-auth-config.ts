import type { Env } from '../worker-env.js';

// 管理画面と API が別サイトにある場合、Cookie は SameSite=None; Secure が必要になる。同一サイトは Lax とし、別サイトの Cookie はブラウザの制限を受けるため明示的な許可を求める。送れない構成で Cookie を発行して成功に見せず、設定エラーとして拒む。

export type AdminSameSite = 'Strict' | 'Lax' | 'None';

export interface AdminAuthConfig {
  /** 資格情報付きの別 origin 要求を許可する送信元。 */
  allowedOrigins: string[];
  /** セッションと CSRF の Cookie に適用する SameSite。 */
  sameSite: AdminSameSite;
  /** Cookie は常に Secure として HTTPS に限る。 */
  secure: boolean;
  /** 管理画面が API と別サイトかを示す。 */
  crossSite: boolean;
  /** ブラウザが返せない Cookie を発行して成功に見せないよう、配送不能な構成はログイン時にこの理由で拒む。 */
  misconfigured: string | null;
}

// 通常のオブジェクトでも検証できるよう、Env 本体と分けて必要な設定を宣言する。
export type AdminAuthEnv = {
  WORKER_URL?: string;
  ADMIN_ORIGIN?: string;
  ADMIN_COOKIE_SAMESITE?: string;
  ADMIN_ALLOW_CROSS_SITE?: string;
};

/** pages.dev や workers.dev は各ホストが別サイトになる。完全な公開サフィックス一覧でなく、この配備構成で使う接尾辞だけを扱う。 */
const MULTI_TENANT_SUFFIXES = [
  'pages.dev',
  'workers.dev',
  'github.io',
  'vercel.app',
  'netlify.app',
];

export function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/** ローカル開発の localhost / 127.0.0.1 / ::1 かを判定する。 */
export function isLoopbackOrigin(value: string | undefined | null): boolean {
  if (!value) return false;
  try {
    const host = new URL(value).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

/** scheme://host[:port] に正規化し、解析できない値は null とする。 */
export function normalizeOrigin(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** 別プロジェクトを同一サイトとしないよう、pages.dev と workers.dev はホストごとに区別する。ほかは末尾2ラベルで登録可能ドメインを求める。 */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  for (const suffix of MULTI_TENANT_SUFFIXES) {
    const suffixLabels = suffix.split('.');
    if (labels.slice(-suffixLabels.length).join('.') === suffix) {
      return labels.slice(-(suffixLabels.length + 1)).join('.');
    }
  }
  return labels.slice(-2).join('.');
}

/** 登録可能ドメインが異なるかを判定する。 */
export function isCrossSite(originA: string, originB: string): boolean {
  try {
    const a = new URL(originA);
    const b = new URL(originB);
    return registrableDomain(a.hostname) !== registrableDomain(b.hostname);
  } catch {
    // 不明な場合は別サイトとみなし、安全側で扱う。
    return true;
  }
}

function parseSameSite(value: string | undefined): AdminSameSite | null {
  if (!value) return null;
  switch (value.trim().toLowerCase()) {
    case 'strict':
      return 'Strict';
    case 'lax':
      return 'Lax';
    case 'none':
      return 'None';
    default:
      return null;
  }
}

/** ADMIN_ORIGIN のカンマ区切りの値を origin へ正規化する。 */
export function parseAllowedOrigins(env: AdminAuthEnv): string[] {
  if (!env.ADMIN_ORIGIN) return [];
  return env.ADMIN_ORIGIN.split(',')
    .map((value) => normalizeOrigin(value.trim()))
    .filter((value): value is string => Boolean(value));
}

function isCloudflarePagesOrigin(value: URL): boolean {
  return value.hostname.toLowerCase().endsWith('.pages.dev');
}

/** 配備直後に開くプレビューでも認証できるよう、同じ Pages プロジェクト内の本番・プレビュー origin を許可先として対応させる。 */
export function isAllowedAdminOrigin(origin: string, allowedOrigin: string): boolean {
  const normalizedOrigin = normalizeOrigin(origin);
  const normalizedAllowed = normalizeOrigin(allowedOrigin);
  if (!normalizedOrigin || !normalizedAllowed) return false;
  if (stripTrailingSlash(normalizedOrigin) === stripTrailingSlash(normalizedAllowed)) {
    return true;
  }

  try {
    const candidate = new URL(normalizedOrigin);
    const allowed = new URL(normalizedAllowed);
    if (candidate.protocol !== allowed.protocol) return false;
    if (!isCloudflarePagesOrigin(candidate) || !isCloudflarePagesOrigin(allowed)) {
      return false;
    }
    return registrableDomain(candidate.hostname) === registrableDomain(allowed.hostname);
  } catch {
    return false;
  }
}

export function resolveAdminAuthConfig(
  env: AdminAuthEnv,
  opts: { requestOrigin?: string } = {},
): AdminAuthConfig {
  const allowedOrigins = parseAllowedOrigins(env);
  // WORKER_URL を優先し、未設定なら API 要求の origin を使う。本番でも別サイト判定を省略しない。
  const workerOrigin = normalizeOrigin(env.WORKER_URL) ?? normalizeOrigin(opts.requestOrigin);

  const crossSite =
    allowedOrigins.length > 0 &&
    workerOrigin != null &&
    allowedOrigins.some((origin) => isCrossSite(origin, workerOrigin));

  const explicit = parseSameSite(env.ADMIN_COOKIE_SAMESITE);
  const allowCrossSite = env.ADMIN_ALLOW_CROSS_SITE === 'true';

  // 別サイトの Cookie は SameSite=None とする。明示指定の上書きがあればそちらを優先する。
  const sameSite: AdminSameSite =
    explicit ?? (allowCrossSite ? 'None' : 'Lax');

  let misconfigured: string | null = null;
  if (crossSite && sameSite !== 'None') {
    misconfigured =
      `Admin origin (${allowedOrigins.join(', ')}) is cross-site to the Worker API ` +
      `(${env.WORKER_URL ?? 'unset'}); a SameSite=${sameSite} session cookie will not be ` +
      `sent and login would break. Either serve the admin under a same-site custom domain, ` +
      `or set ADMIN_ALLOW_CROSS_SITE=true (issues SameSite=None; Secure cookies).`;
  } else if (sameSite === 'None' && allowedOrigins.length === 0) {
    misconfigured =
      `SameSite=None admin cookies require an explicit ADMIN_ORIGIN allowlist for ` +
      `credentialed CORS, but ADMIN_ORIGIN is unset.`;
  }

  return { allowedOrigins, sameSite, secure: true, crossSite, misconfigured };
}

/** 資格情報付き CORS は許可された origin だけを返し、不許可ならヘッダを付けない。同一 origin と Origin のない SDK/MCP の Bearer 要求は許可する。 */
export function resolveCorsOrigin(
  env: AdminAuthEnv,
  origin: string | null | undefined,
  requestUrl: string,
): string {
  let requestOrigin = '';
  try {
    requestOrigin = new URL(requestUrl).origin;
  } catch {
    requestOrigin = '';
  }
  if (!origin) return requestOrigin;

  // Worker 自身がループバックで動く開発環境だけ、別ポートのローカル管理画面を許可する。本番の要求元では有効にしない。
  if (isLoopbackOrigin(requestOrigin) && isLoopbackOrigin(origin)) {
    return origin;
  }

  const { allowedOrigins } = resolveAdminAuthConfig(env);
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return '';

  if (
    requestOrigin &&
    stripTrailingSlash(normalizedOrigin) === stripTrailingSlash(requestOrigin)
  ) {
    return normalizedOrigin;
  }

  return allowedOrigins.some((allowedOrigin) => isAllowedAdminOrigin(normalizedOrigin, allowedOrigin))
    ? normalizedOrigin
    : '';
}
