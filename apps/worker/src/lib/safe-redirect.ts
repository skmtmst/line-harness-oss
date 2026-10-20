/** A stored or signed destination may use the existing non-script schemes. */
const DANGEROUS_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'file:']);
export function storedRedirectTarget(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;

  // Control characters (incl. CR/LF/TAB, code point < 0x20 or DEL 0x7f) enable
  // header-splitting / bypass tricks — never legitimate in a redirect target.
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return null;
  }

  // Protocol-relative forms (`//host`, and the `/\`, `\\`, `\/` backslash
  // variants browsers normalize to `//`) — reject before the relative-path
  // branch below.
  if (/^[/\\][/\\]/.test(value)) return null;

  // Root-relative path (single leading slash) — same-origin, always safe.
  if (value.startsWith('/')) return value;

  // Absolute URL: accept any scheme except the dangerous ones. A value that is
  // neither root-relative nor a parseable absolute URL (e.g. "not a url",
  // bare "evil.com") is rejected rather than guessed.
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return DANGEROUS_SCHEMES.has(url.protocol.toLowerCase()) ? null : value;
}

/** Untrusted URL/query inputs can navigate only within the current origin. */
export function safeRedirectTarget(raw: string | null | undefined, origin?: string): string | null {
  const value = storedRedirectTarget(raw);
  if (!value || /[\\\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const decodedPath = decodeURIComponent(value.split(/[?#]/)[0]);
    if (/[\\\u0000-\u0020\u007f]/.test(decodedPath) || decodedPath.startsWith('//')) return null;
  } catch { return null; }
  try {
    const base = origin || 'https://same-origin.invalid';
    const parsed = new URL(value, base);
    if (parsed.origin !== new URL(base).origin || !/^https?:$/.test(parsed.protocol)) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch { return null; }
}

/** Customer identity belongs only on this Worker's own tracking endpoint. */
export function attributedRedirectTarget(target: string, origin: string, identityToken: string): string {
  const parsed = new URL(target, origin);
  if (parsed.origin !== new URL(origin).origin || !parsed.pathname.startsWith('/t/')) return target;
  parsed.searchParams.delete('lu');
  parsed.searchParams.delete('f');
  parsed.searchParams.delete('identity');
  parsed.searchParams.set('identity', identityToken);
  return parsed.toString();
}
