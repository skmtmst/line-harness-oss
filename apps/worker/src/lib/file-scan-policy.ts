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

/** 1ホスト1鍵・1鍵1ホスト。競合するホスト/鍵の組は全て無効にする。 */
function allowedPairs(value: string | undefined): Map<string, string> {
  const hosts = new Map<string, Set<string>>();
  const keys = new Map<string, Set<string>>();
  for (const entry of (value ?? '').split(',')) {
    if (!entry.trim()) continue;
    const parts = entry.split('=');
    // 読めない設定を部分的な許可へ読み替えない。
    if (parts.length !== 2) return new Map();
    const host = parts[0].trim().toLowerCase();
    const key = parts[1].trim();
    if (!host || !isFileScanSecretRef(key)) return new Map();
    // 不正なホストとの使い回しも先に数えて、安全なホスト側を無効にする。
    if (!hosts.has(host)) hosts.set(host, new Set());
    if (!keys.has(key)) keys.set(key, new Set());
    hosts.get(host)!.add(key);
    keys.get(key)!.add(host);
  }
  const pairs = new Map<string, string>();
  for (const [host, refs] of hosts) {
    const key = refs.values().next().value!;
    if (isPublicHostname(host) && refs.size === 1 && keys.get(key)!.size === 1) pairs.set(host, key);
  }
  return pairs;
}

/** URLの安全性と、運営が許可した同じホスト・鍵の組を保存時/使用時に確認する。 */
export function allowedFileScanEndpoint(value: unknown, pairs: string | undefined, secretRef: unknown): URL | null {
  if (!isFileScanSecretRef(secretRef)) return null;
  if (typeof value !== 'string' || value.length > 500 || /[\s\\]/.test(value)) return null;
  const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1];
  if (!authority || authority.includes('@')) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  // 空のuser-infoも資格情報つきURLとして拒否する。
  if (!isPublicHostname(url.hostname)) return null;
  return allowedPairs(pairs).get(url.hostname) === secretRef ? url : null;
}
