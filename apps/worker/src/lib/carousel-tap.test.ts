import { describe, it, expect } from 'vitest';
import {
  buildCarouselPostbackData,
  parseCarouselPostbackData,
  pickCarouselActions,
} from './carousel-tap.js';

describe('buildCarouselPostbackData', () => {
  it('テンプレートとパネルと選択肢の番号を持つ', () => {
    expect(buildCarouselPostbackData('tpl-1', 0, 2)).toBe('ctpl=tpl-1&c=0&a=2');
  });
});

describe('parseCarouselPostbackData', () => {
  it('組み立てた data を元に戻せる', () => {
    const built = buildCarouselPostbackData('3a7c2f1d-1111-2222-3333-444444444444', 1, 3);
    expect(parseCarouselPostbackData(built)).toEqual({
      templateId: '3a7c2f1d-1111-2222-3333-444444444444',
      columnIndex: 1,
      actionIndex: 3,
    });
  });

  it('関係のない data は素通しさせる（null を返す）', () => {
    expect(parseCarouselPostbackData('tag:premium')).toBeNull();
    expect(parseCarouselPostbackData('rma=area-1')).toBeNull();
    expect(parseCarouselPostbackData('')).toBeNull();
  });

  it('形が崩れていれば読まない', () => {
    expect(parseCarouselPostbackData('ctpl=&c=0&a=0')).toBeNull();
    expect(parseCarouselPostbackData('ctpl=tpl-1&c=x&a=0')).toBeNull();
    expect(parseCarouselPostbackData('ctpl=tpl-1&c=0')).toBeNull();
  });
});

describe('pickCarouselActions', () => {
  const stored = JSON.stringify({
    '0': { '0': [{ actionType: 'tag', config: { op: 'add', tagIds: ['t-1'] } }] },
    '1': { '2': [{ actionType: 'support_mark', config: { markId: 'm-1' } }] },
  });

  it('パネルと選択肢の番号で引く', () => {
    expect(pickCarouselActions(stored, 0, 0)).toHaveLength(1);
    expect(pickCarouselActions(stored, 1, 2)).toHaveLength(1);
  });

  it('設定が無いところは空', () => {
    expect(pickCarouselActions(stored, 0, 1)).toEqual([]);
    expect(pickCarouselActions(stored, 5, 0)).toEqual([]);
    expect(pickCarouselActions(null, 0, 0)).toEqual([]);
  });

  it('読めない設定は空にする（webhook を転ばせない）', () => {
    expect(pickCarouselActions('{壊れた', 0, 0)).toEqual([]);
  });
});
