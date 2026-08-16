import { describe, expect, it } from 'vitest';
import { validateCarousel } from './carousel-validation.js';

function column(over: Record<string, unknown> = {}) {
  return {
    text: '本文です',
    actions: [{ type: 'uri', label: '見る' }],
    ...over,
  };
}

describe('カルーセルの検証', () => {
  it('正しければ何も返さない', () => {
    expect(validateCarousel([column(), column()])).toEqual([]);
  });

  it('配列でなければ弾く', () => {
    expect(validateCarousel({ text: 'x' })).toHaveLength(1);
  });

  it('0枚は弾く', () => {
    expect(validateCarousel([])).toHaveLength(1);
  });

  it('10枚を超えたら弾く', () => {
    const errors = validateCarousel(Array.from({ length: 11 }, () => column()));
    expect(errors.some((e) => e.message.includes('10枚'))).toBe(true);
  });

  it('10枚ちょうどは通る', () => {
    expect(validateCarousel(Array.from({ length: 10 }, () => column()))).toEqual([]);
  });

  it('画像があると本文は60文字まで', () => {
    // 画像があると使える文字数が半分になる。取り違えると、画面では
    // 収まって見えるのに送信時に弾かれる。
    const long = 'あ'.repeat(61);
    const errors = validateCarousel([
      column({ text: long, thumbnailImageUrl: 'https://example.com/a.png' }),
    ]);
    expect(errors.some((e) => e.message.includes('60文字'))).toBe(true);
  });

  it('画像が無ければ120文字まで', () => {
    expect(validateCarousel([column({ text: 'あ'.repeat(120) })])).toEqual([]);
    const errors = validateCarousel([column({ text: 'あ'.repeat(121) })]);
    expect(errors.some((e) => e.message.includes('120文字'))).toBe(true);
  });

  it('絵文字を1文字として数える', () => {
    // 素朴に .length で数えると、絵文字が2文字に見えて誤って弾く。
    expect(validateCarousel([column({ text: '🐶'.repeat(120) })])).toEqual([]);
  });

  it('本文が空なら弾く', () => {
    expect(validateCarousel([column({ text: '   ' })])).toHaveLength(1);
  });

  it('ボタンは1個以上3個まで', () => {
    expect(validateCarousel([column({ actions: [] })]).length).toBeGreaterThan(0);
    const four = Array.from({ length: 4 }, () => ({ type: 'uri', label: 'x' }));
    const errors = validateCarousel([column({ actions: four })]);
    expect(errors.some((e) => e.message.includes('3個'))).toBe(true);
  });

  it('ボタンの文字が空なら弾く', () => {
    const errors = validateCarousel([column({ actions: [{ type: 'uri', label: '  ' }] })]);
    expect(errors.some((e) => e.message.includes('ボタンに文字'))).toBe(true);
  });

  it('画像の有無が混ざっていたら弾く', () => {
    // 1枚だけ画像が無いと、その枚だけ高さが違って崩れる。
    const errors = validateCarousel([
      column({ thumbnailImageUrl: 'https://example.com/a.png' }),
      column(),
    ]);
    expect(errors.some((e) => e.message.includes('画像は全部'))).toBe(true);
  });

  it('問題は何枚目かが分かる形で返る', () => {
    const errors = validateCarousel([column(), column({ text: '' })]);
    expect(errors[0].column).toBe(2);
    expect(errors[0].message).toContain('2枚目');
  });

  it('見つかった問題をすべて返す', () => {
    // 1つ見つけて止めると、直して保存するたびに次の問題が出てきて
    // 何度も往復することになる。
    const errors = validateCarousel([column({ text: '', actions: [] })]);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it('タイトルは40文字まで', () => {
    const errors = validateCarousel([column({ title: 'あ'.repeat(41) })]);
    expect(errors.some((e) => e.message.includes('40文字'))).toBe(true);
  });
});
