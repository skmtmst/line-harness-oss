const FORMAT_VERSION = 'v1';
const IV_BYTES = 12;

export class CredentialEncryptionKeyError extends Error {
  constructor(message = 'LINE_CREDENTIAL_ENCRYPTION_KEY is not configured') {
    super(message);
    this.name = 'CredentialEncryptionKeyError';
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function importEncryptionKey(secret: string | undefined): Promise<CryptoKey> {
  const normalized = secret?.trim();
  if (!normalized) throw new CredentialEncryptionKeyError();

  let raw: Uint8Array;
  try {
    raw = base64UrlToBytes(normalized);
  } catch {
    throw new CredentialEncryptionKeyError(
      'LINE_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
    );
  }
  if (raw.byteLength !== 32) {
    throw new CredentialEncryptionKeyError(
      'LINE_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
    );
  }
  return crypto.subtle.importKey('raw', toArrayBuffer(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Encrypts one credential with a fresh 96-bit IV on every call. */
export async function encryptCredential(value: string, secret: string | undefined): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      await importEncryptionKey(secret),
      toArrayBuffer(new TextEncoder().encode(value)),
    ),
  );
  return `${FORMAT_VERSION}.${bytesToBase64Url(iv)}.${bytesToBase64Url(encrypted)}`;
}

export async function decryptCredential(payload: string, secret: string | undefined): Promise<string> {
  const [version, rawIv, rawEncrypted, extra] = payload.split('.');
  if (version !== FORMAT_VERSION || !rawIv || !rawEncrypted || extra) {
    throw new Error('Unsupported encrypted credential format');
  }
  const iv = base64UrlToBytes(rawIv);
  if (iv.byteLength !== IV_BYTES) throw new Error('Invalid encrypted credential IV');
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    await importEncryptionKey(secret),
    toArrayBuffer(base64UrlToBytes(rawEncrypted)),
  );
  return new TextDecoder().decode(decrypted);
}
