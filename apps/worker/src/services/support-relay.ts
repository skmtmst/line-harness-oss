import { verifyNenWebhook } from '../lib/hmac.js';
export { SUPPORT_EMAIL_RAW_MAX_CHARACTERS } from '../lib/webhook-body.js';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
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
  return (await verifyNenWebhook({
    profile: 'support-relay', secret, timestamp, signature, rawBody: body,
  })).ok;
}

export async function sendViaXServerRelay(
  relayUrl: string,
  secret: string,
  // fromName は差出人の表示名。Xserver 側で許可した名前だけが使われ、
  // それ以外は中継の既定値（然-NEN- お客様窓口）に落ちる。
  input: { to: string; subject: string; body: string; fromName?: string; inReplyTo?: string; references?: string },
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
