import type { Context } from 'hono';
import type { Env } from '../worker-env.js';
import { readBoundedBytes } from '../lib/input-errors.js';

declare module 'hono' {
  interface ContextVariableMap {
    validatedInputBody: object | undefined;
  }
}

/** Keep the existing canonical-key-before-alias precedence, including empty values. */
export function publicLiffQuerySelector(url: string): { liffId: string; accountId: string } {
  const query = new URL(url).searchParams;
  return {
    liffId: (query.get('liffId') ?? query.get('liff_id'))?.trim() || '',
    accountId: (query.get('accountId') ?? query.get('account_id'))?.trim() || '',
  };
}

/** Bound the original stream before selecting a tenant; preserve binary/multipart bytes. */
export async function boundPublicLiffInput(c: Context<Env>): Promise<Response | undefined> {
  if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method.toUpperCase()) || !c.req.raw.body) return;

  // Retain the existing photo/base64 budgets; all other LIFF bodies is at most 1 MiB.
  // This runs even when query selectors exist, before any unbounded JSON parser.
  const maxBytes = /^\/api\/liff\/nen\/photos$/.test(c.req.path)
    ? Math.ceil((8 * 1024 * 1024) / 3) * 4 + 4096
    : /^\/api\/liff\/nen\/pets(?:\/[^/]+\/photo)?$/.test(c.req.path)
      ? Math.ceil(1_500_000 / 3) * 4 + 4096
      : /^\/api\/liff\/visit-stamps\/cards\/[^/]+\/paper-photos$/.test(c.req.path)
        ? 5 * 1024 * 1024 + 65536
        : 1024 * 1024;
  const bytes = await readBoundedBytes(c.req.raw, maxBytes);
  if (bytes === null) return c.json({ success: false, code: 'liff_body_too_large', error: '送信内容が大きすぎます' }, 413);
  // Preserve a present-but-empty body so the downstream JSON guard still rejects it.
  c.req.raw = new Request(c.req.raw, { body: bytes });
  const { liffId, accountId } = publicLiffQuerySelector(c.req.url);
  if (liffId || accountId) return;
  // Multipart and binary uploads cannot contain a selector object. Avoid a
  // second full-size string allocation, while still recognizing mislabeled JSON.
  let start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  while (bytes[start] === 0x20 || bytes[start] === 0x09 || bytes[start] === 0x0a || bytes[start] === 0x0d) start++;
  if (bytes[start] !== 0x7b) return;
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (body && typeof body === 'object' && !Array.isArray(body)) c.set('validatedInputBody', body as Record<string, unknown>);
  } catch {
    // Keep the route's existing malformed/non-object JSON response contract.
  }
}
