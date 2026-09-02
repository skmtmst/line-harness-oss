import { buildDefaultColumnIntro } from './nen-engagement.js';

export const NEN_COLUMN_CREATE_MAX_BYTES = 16 * 1024;

export type NenColumnCreateError =
  | 'payload_too_large'
  | 'request_invalid'
  | 'title_invalid'
  | 'category_too_long'
  | 'excerpt_too_long'
  | 'article_url_invalid'
  | 'image_url_invalid'
  | 'published_at_invalid';

export type NenColumnCreateInput = {
  title: string;
  category: string | null;
  excerpt: string;
  articleUrl: string;
  imageUrl: string | null;
  publishedAt: string | null;
  slug: string;
};

export type NenColumnStorageFields = {
  title: string;
  category: string | null;
  excerpt: string;
  introText: string;
  articleUrl: string;
  imageUrl: string | null;
  publishedAt: string | null;
};

type ParseResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; status: 400 | 413; error: 'request_invalid' | 'payload_too_large' };

type ValidationResult =
  | { ok: true; value: NenColumnCreateInput }
  | { ok: false; error: Exclude<NenColumnCreateError, 'payload_too_large'> };

const CREATE_KEYS = new Set([
  'title', 'category', 'excerpt', 'articleUrl', 'imageUrl', 'publishedAt',
]);

/**
 * 小さい管理画面JSONだけを読む。Content-Lengthだけを信用せず、chunkedでも
 * 上限を越えた時点で読み取りを止める。
 */
export async function readBoundedJsonObject(
  request: Request,
  maxBytes = NEN_COLUMN_CREATE_MAX_BYTES,
): Promise<ParseResult> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, status: 413, error: 'payload_too_large' };
  }
  if (!request.body) return { ok: false, status: 400, error: 'request_invalid' };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413, error: 'payload_too_large' };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    const value = JSON.parse(decoded) as unknown;
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      return { ok: false, status: 400, error: 'request_invalid' };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return { ok: false, status: 400, error: 'request_invalid' };
  }
}

/** 外部同期と管理画面で共用するHTTPS検査。保存値を返し、無効ならnull。 */
export function normalizeHttpsUrl(
  value: string,
  options: { maxLength?: number; allowCredentials?: boolean } = {},
): string | null {
  const normalized = value.trim();
  if (!normalized || normalized.length > (options.maxLength ?? Number.POSITIVE_INFINITY)) return null;
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'https:') return null;
    if (!options.allowCredentials && (parsed.username || parsed.password)) return null;
    return normalized;
  } catch {
    return null;
  }
}

export function slugFromArticleUrl(articleUrl: string): string | null {
  try {
    if (new URL(articleUrl).protocol !== 'https:') return null;
  } catch {
    return null;
  }
  /*
   * URLは `/columns/.` や `%2E%2E` を正規化して消す。正規化後のpathnameから
   * slugを作ると、禁止した`.`が一つ前の`columns`へ化けるため、検査済みURLの
   * **入力時のpath**を使う。query/hashはslugに含めない。
   */
  const authorityEnd = articleUrl.indexOf('://') + 3;
  const afterAuthority = articleUrl.slice(authorityEnd);
  const suffixStart = afterAuthority.search(/[?#]/);
  const authorityAndPath = suffixStart >= 0 ? afterAuthority.slice(0, suffixStart) : afterAuthority;
  const pathStart = authorityAndPath.indexOf('/');
  const rawPath = pathStart >= 0 ? authorityAndPath.slice(pathStart) : '';
  const pathname = rawPath.replace(/\/+$/, '');
  const encoded = pathname.slice(pathname.lastIndexOf('/') + 1);
  let slug: string;
  try {
    slug = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  if (!slug || slug === '.' || slug === '..' || slug.length > 160) return null;
  if (/[\/\u0000-\u001f\u007f]/.test(slug)) return null;
  return slug;
}

export function validateNenColumnCreateBody(body: Record<string, unknown>): ValidationResult {
  if (Object.keys(body).some((key) => !CREATE_KEYS.has(key))) {
    return { ok: false, error: 'request_invalid' };
  }

  if (typeof body.title !== 'string') return { ok: false, error: 'title_invalid' };
  const title = body.title.trim();
  if (!title || title.length > 120) return { ok: false, error: 'title_invalid' };

  if (body.category !== undefined && typeof body.category !== 'string') {
    return { ok: false, error: 'request_invalid' };
  }
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  if (category.length > 60) return { ok: false, error: 'category_too_long' };

  if (body.excerpt !== undefined && typeof body.excerpt !== 'string') {
    return { ok: false, error: 'request_invalid' };
  }
  const excerpt = typeof body.excerpt === 'string' ? body.excerpt.trim() : '';
  if (excerpt.length > 500) return { ok: false, error: 'excerpt_too_long' };

  if (typeof body.articleUrl !== 'string') return { ok: false, error: 'article_url_invalid' };
  const articleUrl = normalizeHttpsUrl(body.articleUrl, { maxLength: 2048, allowCredentials: false });
  if (!articleUrl) return { ok: false, error: 'article_url_invalid' };
  const slug = slugFromArticleUrl(articleUrl);
  if (!slug) return { ok: false, error: 'article_url_invalid' };

  if (body.imageUrl !== undefined && body.imageUrl !== null && typeof body.imageUrl !== 'string') {
    return { ok: false, error: 'request_invalid' };
  }
  const imageUrl = typeof body.imageUrl === 'string'
    ? normalizeHttpsUrl(body.imageUrl, { maxLength: 2048, allowCredentials: false })
    : null;
  if (typeof body.imageUrl === 'string' && !imageUrl) {
    return { ok: false, error: 'image_url_invalid' };
  }

  let publishedAt: string | null = null;
  if (body.publishedAt !== undefined && body.publishedAt !== null) {
    if (typeof body.publishedAt !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(body.publishedAt)
      || !Number.isFinite(Date.parse(body.publishedAt))) {
      return { ok: false, error: 'published_at_invalid' };
    }
    publishedAt = new Date(body.publishedAt).toISOString();
  }

  return {
    ok: true,
    value: {
      title,
      category: category || null,
      excerpt,
      articleUrl,
      imageUrl,
      publishedAt,
      slug,
    },
  };
}

/** HMAC同期と管理画面作成で、DBへ渡す列の組み立てを1か所にする。 */
export function buildNenColumnStorageFields(input: {
  title: string;
  category: string | null;
  excerpt: string;
  articleUrl: string;
  imageUrl: string | null;
  publishedAt: string | null;
}): NenColumnStorageFields {
  return {
    ...input,
    introText: buildDefaultColumnIntro(input.title, input.excerpt),
  };
}

export function isNenColumnSlugConflict(error: unknown): boolean {
  return /UNIQUE constraint failed:\s*nen_columns\.slug/i.test(
    error instanceof Error ? error.message : String(error),
  );
}
