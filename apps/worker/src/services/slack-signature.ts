const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signSlackRequest(
  secret: string,
  timestamp: string,
  rawBody: string,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey(secret),
    new TextEncoder().encode(`v0:${timestamp}:${rawBody}`),
  );
  const hex = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `v0=${hex}`;
}

export async function verifySlackRequest(
  secret: string,
  timestamp: string | undefined,
  signature: string | undefined,
  rawBody: string,
): Promise<boolean> {
  if (!timestamp || !/^\d{10}$/.test(timestamp) || !signature?.startsWith('v0=')) return false;
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_CLOCK_SKEW_SECONDS) return false;
  const signatureBytes = hexToBytes(signature.slice(3));
  if (!signatureBytes) return false;
  return crypto.subtle.verify(
    'HMAC',
    await signingKey(secret),
    signatureBytes,
    new TextEncoder().encode(`v0:${timestamp}:${rawBody}`),
  );
}
