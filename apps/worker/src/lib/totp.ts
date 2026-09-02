const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Uint8Array {
  const normalized = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const character of normalized) {
    const index = BASE32.indexOf(character);
    if (index < 0) throw new Error('Invalid base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(output);
}

export function generateTotpSecret(bytes = 20): string {
  const random = new Uint8Array(bytes);
  crypto.getRandomValues(random);
  return base32Encode(random);
}

function counterBytes(step: number): Uint8Array {
  const value = BigInt(step);
  const result = new Uint8Array(8);
  for (let i = 7; i >= 0; i -= 1) result[i] = Number((value >> BigInt((7 - i) * 8)) & 0xffn);
  return result;
}

export async function totpAtStep(secret: string, step: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    base32Decode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes(step)));
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = (
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  ) >>> 0;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

export async function verifyTotp(
  secret: string,
  code: string,
  nowMs = Date.now(),
  lastUsedStep: number | null = null,
): Promise<{ valid: boolean; step: number | null }> {
  const normalized = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return { valid: false, step: null };
  const current = Math.floor(nowMs / 1000 / STEP_SECONDS);
  for (const delta of [-1, 0, 1]) {
    const step = current + delta;
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (timingSafeEqual(await totpAtStep(secret, step), normalized)) return { valid: true, step };
  }
  return { valid: false, step: null };
}

async function encryptionKey(masterKey: string): Promise<CryptoKey> {
  if (masterKey.length < 32) throw new Error('TOTP_ENCRYPTION_KEY must contain at least 32 characters');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(masterKey));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptTotpSecret(secret: string, masterKey: string): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(masterKey),
    new TextEncoder().encode(secret),
  ));
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(encrypted)}`;
}

export async function decryptTotpSecret(payload: string, masterKey: string): Promise<string> {
  const [version, rawIv, rawEncrypted] = payload.split('.');
  if (version !== 'v1' || !rawIv || !rawEncrypted) throw new Error('Invalid encrypted TOTP secret');
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlToBytes(rawIv) },
    await encryptionKey(masterKey),
    base64UrlToBytes(rawEncrypted),
  );
  return new TextDecoder().decode(decrypted);
}

export function buildTotpUri(secret: string, accountName: string, issuer = '然-NEN-公式'): string {
  const label = `${issuer}:${accountName}`;
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}
