/** Short lived, purpose-bound capability. Never sign a caller-provided origin. */
export const DOWNLOAD_TTL_SECONDS = 15 * 60;

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function message(purpose: string, resource: string, owner: string, expires: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(['download:v1', purpose, resource, owner, expires]));
}

export async function signDownload(
  url: URL, secret: string | undefined, purpose: string, resource: string, owner: string, deadline?: number,
): Promise<string> {
  if (!secret) throw new Error('download_signing_unconfigured');
  const now = Date.now();
  if (deadline !== undefined && (!Number.isFinite(deadline) || deadline <= now)) throw new Error('download_expired');
  const expires = String(Math.min(Math.floor(now / 1000) + DOWNLOAD_TTL_SECONDS, Math.floor((deadline ?? Infinity) / 1000)));
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), message(purpose, resource, owner, expires)));
  url.search = '';
  url.searchParams.set('expires', expires);
  url.searchParams.set('signature', Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''));
  return url.toString();
}

export async function validDownload(
  url: URL, secret: string | undefined, purpose: string, resource: string, owner: string,
): Promise<boolean> {
  const expires = url.searchParams.get('expires') ?? '';
  const signature = url.searchParams.get('signature') ?? '';
  const now = Math.floor(Date.now() / 1000);
  if (!secret || !/^\d{10}$/.test(expires) || !/^[a-f0-9]{64}$/.test(signature)
    || Number(expires) <= now || Number(expires) > now + DOWNLOAD_TTL_SECONDS) return false;
  // The format check above fixes the signature at exactly 32 bytes.
  const bytes = Uint8Array.from({ length: 32 }, (_, i) => parseInt(signature.slice(i * 2, i * 2 + 2), 16));
  return crypto.subtle.verify('HMAC', await key(secret), bytes, message(purpose, resource, owner, expires));
}
