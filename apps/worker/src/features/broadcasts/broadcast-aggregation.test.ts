/*
 * 開封数の集計ユニット。
 *
 * LINE の集計ユニットは**アカウントあたり月1,000**まで。1配信＝1ユニットなので、
 * 全部の配信で付けると月1,000配信で頭打ちになる。しかも上限に当たったことは
 * 送信のエラーにならず、**あとから数字が出ないだけ**なので気づけない。
 */
import { describe, it, expect } from 'vitest';
import { aggregationUnitFor, aggregationUnits } from './broadcast-aggregation.js';

describe('集計ユニット', () => {
  it('既定では取る', () => {
    expect(aggregationUnitFor({ id: '031329b7-703d-4e89-a5d7-25690acf079e' }))
      .toBe('bcast_031329b7');
  });

  it('「取らない」を選んだ配信には付けない', () => {
    expect(aggregationUnitFor({ id: 'abc', measure_opens: 0 })).toBeNull();
  });

  it('この列が入る前の配信は、これまでどおり取る', () => {
    // undefined / null を「取らない」と読むと、過去の配信の開封数が
    // 静かに取れなくなる。
    expect(aggregationUnitFor({ id: 'abc' })).not.toBeNull();
    expect(aggregationUnitFor({ id: 'abc', measure_opens: null })).not.toBeNull();
  });

  it('LINEが受け付ける形にする（英数字と _ のみ、30文字以内）', () => {
    const unit = aggregationUnitFor({ id: 'aa-bb-cc-dd-ee' })!;
    expect(unit).toMatch(/^[a-zA-Z0-9_]{1,30}$/);
  });

  it('取らないときは引数ごと省く', () => {
    // 空配列を渡すと、LINE 側で「ユニット指定あり」と解釈されうる。
    expect(aggregationUnits(null)).toBeUndefined();
    expect(aggregationUnits('bcast_x')).toEqual(['bcast_x']);
  });
});
