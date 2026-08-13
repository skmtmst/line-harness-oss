const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const result = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    result[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return result;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signSupportRelay(secret: string, timestamp: string, body: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  return bytesToHex(new Uint8Array(signature));
}

export async function verifySupportRelay(
  secret: string,
  timestamp: string | undefined,
  signature: string | undefined,
  body: string,
): Promise<boolean> {
  if (!timestamp || !signature || !/^\d{10}$/.test(timestamp)) return false;
  const signatureBytes = hexToBytes(signature);
  if (!signatureBytes) return false;
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_CLOCK_SKEW_SECONDS) return false;
  return crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    signatureBytes,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
}

export async function sendViaXServerRelay(
  relayUrl: string,
  secret: string,
  input: { to: string; subject: string; body: string; inReplyTo?: string; references?: string },
): Promise<string> {
  const body = JSON.stringify(input);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const response = await fetch(relayUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-nen-timestamp': timestamp,
      'x-nen-signature': await signSupportRelay(secret, timestamp, body),
    },
    body,
  });
  const result: { success?: boolean; messageId?: string; error?: string } = await response
    .json<{ success?: boolean; messageId?: string; error?: string }>()
    .catch(() => ({}));
  if (!response.ok || !result.success || !result.messageId) {
    throw new Error(`XSERVER_RELAY_FAILED:${response.status}:${result.error || 'unknown'}`);
  }
  return result.messageId;
}
