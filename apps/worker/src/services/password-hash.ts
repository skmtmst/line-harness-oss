/**
 * パスワードのハッシュ（★V6 36-4 会員登録・メールログイン）。
 *
 * Workers 標準の WebCrypto だけで動く PBKDF2-SHA256 を使う（依存を増やさない）。
 * Cloudflare Workers は PBKDF2 の繰り返し回数を 100,000 までに制限しているので、その上限で固定する。
 * 保存形式: `pbkdf2-sha256$<iterations>$<salt base64>$<hash base64>`。
 * 形式に回数を持つので、あとで回数を変えても古いハッシュの検証はできる。
 */

const ALGORITHM = 'pbkdf2-sha256';
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

/** 8 文字以上・128 文字以内・英字と数字を両方含む（設計 36-4「8文字以上・英数」）。 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export function validatePasswordPolicy(password: string): string | null {
  if (typeof password !== 'string' || password.length === 0) return 'パスワードを入力してください';
  if (password.length < PASSWORD_MIN_LENGTH) return `パスワードは${PASSWORD_MIN_LENGTH}文字以上で入力してください`;
  if (password.length > PASSWORD_MAX_LENGTH) return `パスワードは${PASSWORD_MAX_LENGTH}文字以内で入力してください`;
  if (/\s/.test(password)) return 'パスワードに空白は使えません';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'パスワードは英字と数字の両方を含めてください';
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    HASH_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const hash = await derive(password, salt, ITERATIONS);
  return `${ALGORITHM}$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** 保存形式が壊れていても例外を出さず false を返す。 */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored || typeof password !== 'string') return false;
  const [algorithm, iterationsText, saltText, hashText] = stored.split('$');
  if (algorithm !== ALGORITHM || !iterationsText || !saltText || !hashText) return false;
  const iterations = Number.parseInt(iterationsText, 10);
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > ITERATIONS) return false;
  try {
    const expected = fromBase64(hashText);
    const actual = await derive(password, fromBase64(saltText), iterations);
    return constantTimeEqual(actual, expected);
  } catch {
    return false;
  }
}
