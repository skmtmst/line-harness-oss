/** 店の設定と運営の許可設定を、保存時・使用時の同じ境界で検査する。 */
export function isFileScanSecretRef(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 120
    && /^FILE_SCAN_SECRET_[A-Z0-9_]+$/.test(value);
}

function isPublicHostname(host: string): boolean {
  if (host.length > 253 || !host.includes('.') || host.endsWith('.')) return false;
  const labels = host.split('.');
  if (!labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return false;
  // 数値TLDを拒否することで、URLパーサーが正規化したIPv4も通さない。
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/.test(labels.at(-1)!)) return false;
  const internalSuffixes = ['localhost', 'local', 'internal', 'lan', 'home', 'home.arpa',
    'intranet', 'corp', 'localdomain', 'test', 'invalid', 'example', 'onion'];
  return host !== 'metadata.google.com' && !host.endsWith('.metadata.google.com')
    && !internalSuffixes.some(suffix => host === suffix || host.endsWith(`.${suffix}`));
}

/** 許可は正確なホスト名だけ。URL、ワイルドカード、IP、ポート指定は許可にならない。 */
export function allowedFileScanEndpoint(value: unknown, allowedHosts: string | undefined): URL | null {
  if (typeof value !== 'string' || value.length > 500 || /[\s\\]/.test(value)) return null;
  const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1];
  if (!authority || authority.includes('@')) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  // 空のuser-infoも資格情報つきURLとして拒否する。
  if (!isPublicHostname(url.hostname)) return null;
  const hosts = (allowedHosts ?? '').split(',').map(host => host.trim().toLowerCase())
    .filter(isPublicHostname);
  return hosts.includes(url.hostname) ? url : null;
}
