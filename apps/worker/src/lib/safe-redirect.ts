/** 保存済みまたは署名済みの移動先では、既存のスクリプト以外のスキームを保つ。 */
const DANGEROUS_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'file:']);
export function storedRedirectTarget(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;

  // 制御文字はヘッダ分割や検査回避に使えるため、CR/LF/TAB・0x20未満・DELを拒む。
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return null;
  }

  // ブラウザが別ホストと解釈する // やバックスラッシュの変形は、同一 origin の相対パスと判定する前に拒む。
  if (/^[/\\][/\\]/.test(value)) return null;

  // 先頭が単一スラッシュの絶対パスは同一 origin 内へ移動する。
  if (value.startsWith('/')) return value;

  // 危険なスキーム以外の絶対 URL を許可する。相対パスでも解析可能な絶対 URL でもない値は、推測で補わず拒む。
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return DANGEROUS_SCHEMES.has(url.protocol.toLowerCase()) ? null : value;
}

/** 信頼できないクエリの移動先は、現在の origin 内に限る。 */
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

/** 顧客の識別情報は、この Worker の計測経路だけへ渡す。 */
export function attributedRedirectTarget(target: string, origin: string, identityToken: string): string {
  const parsed = new URL(target, origin);
  if (parsed.origin !== new URL(origin).origin || !parsed.pathname.startsWith('/t/')) return target;
  parsed.searchParams.delete('lu');
  parsed.searchParams.delete('f');
  parsed.searchParams.delete('identity');
  parsed.searchParams.set('identity', identityToken);
  return parsed.toString();
}
