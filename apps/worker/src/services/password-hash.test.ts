import { vi, describe, expect, it } from 'vitest';
import { hashPassword, validatePasswordPolicy, verifyPassword } from './password-hash.js';

describe('パスワードのハッシュ（36-4）', () => {
  it('同じパスワードでも塩が違うので別のハッシュになり、どちらでも照合できる', async () => {
    const a = await hashPassword('Abcdefg1');
    const b = await hashPassword('Abcdefg1');
    expect(a).not.toBe(b);
    expect(a.startsWith('pbkdf2-sha256$100000$')).toBe(true);
    expect(await verifyPassword('Abcdefg1', a)).toBe(true);
    expect(await verifyPassword('Abcdefg1', b)).toBe(true);
    expect(await verifyPassword('Abcdefg2', a)).toBe(false);
  });

  it('保存形式が壊れていても例外にせず false', async () => {
    expect(await verifyPassword('x', null)).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt$1$aa$bb')).toBe(false);
    expect(await verifyPassword('x', 'pbkdf2-sha256$999999999$aa$bb')).toBe(false);
    expect(await verifyPassword('x', 'pbkdf2-sha256$1000$!!!$bb')).toBe(false);
  });

  it('13文字以上・大小英字・数字・特殊記号・空白なし', () => {
    expect(validatePasswordPolicy('')).toContain('入力');
    expect(validatePasswordPolicy('abc1')).toContain('13文字');
    expect(validatePasswordPolicy('a'.repeat(13))).toContain('英大文字');
    expect(validatePasswordPolicy('A'.repeat(13))).toContain('英小文字');
    expect(validatePasswordPolicy('Aa'.repeat(7))).toContain('数字');
    expect(validatePasswordPolicy('Aa1'.repeat(5))).toContain('特殊記号');
    expect(validatePasswordPolicy('Aa1! '.repeat(3))).toContain('空白');
    expect(validatePasswordPolicy('a'.repeat(128) + '1')).toContain('128文字');
    expect(validatePasswordPolicy('StrongPassword1!')).toBeNull();
  });
});


it('F20: missing credentials perform the same PBKDF2 work', async () => {
  const spy = vi.spyOn(crypto.subtle, 'deriveBits');
  try {
    expect(await verifyPassword('wrong', null)).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ name: 'PBKDF2', iterations: 100000 });
  } finally { spy.mockRestore(); }
});
