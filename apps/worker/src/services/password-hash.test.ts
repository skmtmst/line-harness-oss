import { describe, expect, it } from 'vitest';
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

  it('8文字以上・英数の両方・空白なし', () => {
    expect(validatePasswordPolicy('')).toContain('入力');
    expect(validatePasswordPolicy('abc1')).toContain('8文字');
    expect(validatePasswordPolicy('abcdefgh')).toContain('英字と数字');
    expect(validatePasswordPolicy('12345678')).toContain('英字と数字');
    expect(validatePasswordPolicy('abcd 1234')).toContain('空白');
    expect(validatePasswordPolicy('a'.repeat(128) + '1')).toContain('128文字');
    expect(validatePasswordPolicy('abcdefg1')).toBeNull();
  });
});
