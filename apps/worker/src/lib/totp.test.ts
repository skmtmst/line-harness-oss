import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, decryptTotpSecret, encryptTotpSecret, totpAtStep, verifyTotp } from './totp.js';

describe('TOTP', () => {
  it('encodes and decodes base32', () => {
    const input = new TextEncoder().encode('12345678901234567890');
    expect(base32Encode(input)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(Array.from(base32Decode(base32Encode(input)))).toEqual(Array.from(input));
  });

  it('matches RFC 6238 SHA-1 vectors truncated to six digits', async () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(await totpAtStep(secret, 1)).toBe('287082');
    expect(await verifyTotp(secret, '287082', 59_000)).toEqual({ valid: true, step: 1 });
    expect(await verifyTotp(secret, '287082', 59_000, 1)).toEqual({ valid: false, step: null });
  });

  it('encrypts secrets with authenticated encryption', async () => {
    const key = 'test-master-key-which-is-longer-than-32-characters';
    const encrypted = await encryptTotpSecret('ABCDEF2345', key);
    expect(encrypted).not.toContain('ABCDEF2345');
    expect(await decryptTotpSecret(encrypted, key)).toBe('ABCDEF2345');
  });
});
