import { describe, expect, it } from 'vitest';
import {
  fieldsToLayout,
  formatAddressValue,
  formatPostalCode,
  layoutToFields,
  normalizePostalCodeDigits,
  normalizeRatingValue,
  validateAnswer,
  type FormInputBlock,
} from './form-layout.js';

function block(overrides: Partial<FormInputBlock> = {}): FormInputBlock {
  return {
    id: 'b1',
    kind: 'input',
    type: 'rating',
    name: 'satisfaction',
    label: '満足度',
    ...overrides,
  } as FormInputBlock;
}

describe('F11 rating', () => {
  it('1〜5の整数だけ通す', () => {
    expect(validateAnswer(block(), 3)).toBeNull();
    expect(validateAnswer(block(), '5')).toBeNull();
    expect(validateAnswer(block(), ' 3 ')).toBeNull();
    expect(validateAnswer(block(), 0)).toContain('1〜5');
    expect(validateAnswer(block(), 6)).toContain('1〜5');
    expect(validateAnswer(block(), 2.5)).toContain('1〜5');
    expect(validateAnswer(block(), 'good')).toContain('1〜5');
    expect(validateAnswer(block(), {})).toContain('1〜5');
  });

  it('保存・平均と一致させるため "3.0" "3e0" 真偽値は通さない', () => {
    expect(validateAnswer(block(), '3.0')).toContain('1〜5');
    expect(validateAnswer(block(), '3e0')).toContain('1〜5');
    expect(validateAnswer(block(), true)).toContain('1〜5');
    expect(validateAnswer(block(), false)).toContain('1〜5');
    expect(normalizeRatingValue('3.0')).toBeNull();
    expect(normalizeRatingValue('3e0')).toBeNull();
    expect(normalizeRatingValue(true)).toBeNull();
    expect(normalizeRatingValue('3')).toBe(3);
  });

  it('必須の空欄は必須文言、任意の空欄は通す', () => {
    expect(validateAnswer(block({ required: true }), null)).toContain('必須');
    expect(validateAnswer(block(), null)).toBeNull();
  });

  it('normalizeは文字列の3を数にする', () => {
    expect(normalizeRatingValue('3')).toBe(3);
    expect(normalizeRatingValue(0)).toBeNull();
    expect(normalizeRatingValue(Number.NaN)).toBeNull();
  });

  it('ASCII空白だけ許し、全角空白・タブ・改行は平均から外れるため止める', () => {
    expect(validateAnswer(block(), ' 3 ')).toBeNull();
    expect(normalizeRatingValue(' 3 ')).toBe(3);
    expect(validateAnswer(block(), '　3　')).toContain('1〜5');
    expect(validateAnswer(block(), '\t3')).toContain('1〜5');
    expect(validateAnswer(block(), '3\n')).toContain('1〜5');
    expect(normalizeRatingValue('　3　')).toBeNull();
    expect(normalizeRatingValue('\t3')).toBeNull();
    // ASCII空白だけは未入力扱い。全角空白だけは未入力にせず止める。
    expect(validateAnswer(block(), ' ')).toBeNull();
    expect(validateAnswer(block(), '　　')).toContain('1〜5');
  });
});

describe('F11 address', () => {
  const addr = () => block({ type: 'address', name: 'address', label: '住所' });

  it('先頭0を保ち、形違いを止める', () => {
    expect(normalizePostalCodeDigits('060-0000')).toBe('0600000');
    expect(normalizePostalCodeDigits('0600000')).toBe('0600000');
    expect(normalizePostalCodeDigits(' 100-0001 ')).toBe('1000001');
    expect(normalizePostalCodeDigits('１０００００１')).toBe('1000001');
    expect(normalizePostalCodeDigits('12345')).toBeNull();
    expect(normalizePostalCodeDigits('abc1000001')).toBeNull();
    expect(normalizePostalCodeDigits('060 0000')).toBeNull();
    expect(formatPostalCode('0600000')).toBe('060-0000');
  });

  it('指定済み欄の型違いを黙って空にしない', () => {
    const addr = () => block({ type: 'address', name: 'address', label: '住所' });
    expect(validateAnswer(addr(), { postalCode: 1000001 })).toContain('郵便番号');
    expect(validateAnswer(addr(), { city: 123 })).toContain('文字');
    expect(validateAnswer(addr(), { city: ['千代田区'] })).toContain('文字');
    expect(validateAnswer(addr(), { addressLine1: {番地: 1} as unknown as string })).toContain('文字');
    expect(validateAnswer(addr(), { prefecture: 13 as unknown as string })).toContain('都道府県');
    expect(validateAnswer(addr(), { city: 'x'.repeat(256) })).toContain('長すぎ');
    expect(validateAnswer(addr(), {
      postalCode: '100-0001', prefecture: '東京都', city: '千代田区', addressLine1: '1-1',
    })).toBeNull();
  });

  it('郵便番号の形違いと都道府県違いを止める', () => {
    expect(validateAnswer(addr(), {
      postalCode: '12345', prefecture: '東京都', city: '千代田区', addressLine1: '1-1',
    })).toContain('郵便番号');
    expect(validateAnswer(addr(), {
      postalCode: '100-0001', prefecture: '東京', city: '千代田区', addressLine1: '1-1',
    })).toContain('都道府県');
  });

  it('空配列の指定は空扱いで型検査を迂回させない', () => {
    expect(validateAnswer(addr(), { city: [] as unknown as string })).toContain('文字');
    expect(validateAnswer(
      block({ type: 'address', name: 'a', label: '住所', required: true }),
      { city: [] as unknown as string },
    )).not.toBeNull();
    // 未指定・空文字・空白文字列は空のまま通す。
    expect(validateAnswer(addr(), {})).toBeNull();
    expect(validateAnswer(addr(), { city: '' })).toBeNull();
    expect(validateAnswer(addr(), { city: '   ' })).toBeNull();
    expect(validateAnswer(addr(), { city: undefined })).toBeNull();
    expect(validateAnswer(addr(), { city: null as unknown as string })).toBeNull();
  });

  it('空は必須だけ止め、手入力の残りは通す', () => {
    expect(validateAnswer(addr(), {})).toBeNull();
    expect(validateAnswer(addr(), { prefecture: '', city: '', addressLine1: '' })).toBeNull();
    expect(validateAnswer(block({ type: 'address', name: 'a', label: '住所', required: true }), {})).toContain('必須');
    expect(validateAnswer(addr(), {
      postalCode: '', prefecture: '東京都', city: '千代田区', addressLine1: '手入力の番地',
    })).toBeNull();
  });

  it('[object Object]にしない', () => {
    expect(formatAddressValue({
      postalCode: '0600000', prefecture: '北海道', city: '札幌市中央区', addressLine1: '1-1',
    })).toContain('札幌市中央区');
    expect(formatAddressValue({
      postalCode: '0600000', prefecture: '北海道', city: '札幌市中央区', addressLine1: '1-1',
    })).not.toContain('[object Object]');
  });
});

describe('F11 roundtrip', () => {
  it('rating・addressをfields↔layoutで落とさない', () => {
    const layout = fieldsToLayout([
      { name: 's', label: '満足度', type: 'rating', required: true },
      { name: 'a', label: '住所', type: 'address' },
    ]);
    const types = layout.sections[0].blocks
      .filter((b) => b.kind === 'input')
      .map((b) => (b as FormInputBlock).type);
    expect(types).toEqual(['rating', 'address']);
    const fields = layoutToFields(layout);
    expect(fields.map((f) => f.type)).toEqual(['rating', 'address']);
    const back = fieldsToLayout(fields);
    const backTypes = back.sections[0].blocks
      .filter((b) => b.kind === 'input')
      .map((b) => (b as FormInputBlock).type);
    expect(backTypes).toEqual(['rating', 'address']);
  });
});
