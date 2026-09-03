import { describe, expect, it } from 'vitest'

import { describeStepAudience } from './scenario-step-audience'

/*
  **形が違う値で落ちないことを、試験で押さえる。**

  `targetCondition` はDBのJSON列がそのまま `unknown` で来る。世代の違う行や、
  途中まで書いて保存された行が混ざる。`asCondition` はそれを弾いて
  「絞り込みなし」に落とすが、**その守りを見張るものが無かった。**
  消しても既存の試験は緑のままで、次に古い行が来たとき
  `rules.filter is not a function` で**通の一覧ごと落ちる。**

  言い方そのもの（「購読中の全員」「タグ：〜」「詳細条件 N件」）は
  `scenario-detail-v6-feature5-contract.test.ts` が見ているので、ここでは
  **守りだけ**を見る。同じことを2か所で見張らない。
*/
describe('配信対象の桁は、形が違う値で落ちない', () => {
  const tags = [{ id: 'tag-1', name: '初回案内' }]

  it('object でない値', () => {
    expect(describeStepAudience('こわれた値', tags)).toBe('購読中の全員')
    expect(describeStepAudience(42, tags)).toBe('購読中の全員')
    expect(describeStepAudience(undefined, tags)).toBe('購読中の全員')
  })

  it('rules が配列でない値', () => {
    expect(describeStepAudience({ operator: 'AND', rules: 'ちがう形' }, tags)).toBe('購読中の全員')
    expect(describeStepAudience({ operator: 'AND' }, tags)).toBe('購読中の全員')
  })

  it('groups が配列でない値', () => {
    expect(describeStepAudience({ operator: 'AND', rules: [], groups: 'ちがう形' }, tags))
      .toBe('購読中の全員')
  })

  it('入れ子の groups に形の違うものが混ざっていても、読めるところだけ数える', () => {
    const raw = {
      operator: 'AND',
      rules: [{ type: 'private_memo', value: 'あ' }],
      groups: ['こわれた値', { operator: 'OR', rules: [{ type: 'tag_exists', value: 'tag-1' }] }],
    }
    expect(describeStepAudience(raw, tags)).toBe('詳細条件 1件 ＋ or条件 1組')
  })

  /*
    **消えたタグのIDを画面に出さない。**
    タグ1つだけの絞り込みで名前が引けないとき、IDへ落とすと
    `tag-01H8...` のような内部の識別子が通の一覧に並ぶ。
  */
  it('名前が引けないタグのIDを出さない', () => {
    const raw = { operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-消えた' }] }
    const text = describeStepAudience(raw, [])
    expect(text).toBe('詳細条件 1件')
    expect(text).not.toContain('tag-')
  })
})
