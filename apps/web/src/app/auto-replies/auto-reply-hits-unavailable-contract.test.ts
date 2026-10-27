import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { metricWord } from '../../v8/auto-replies/auto-reply-words'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readUiSource(new URL('../../v8/auto-replies/list.tsx', import.meta.url), 'utf8')

/**
 * 自動応答一覧（設計 `cmDfJ` 8-1 ／ `q8wSqO` 8-1-J）で、
 * **ヒット数が「数えられていない」ことと「0回だった」ことを取り違えない**。
 *
 * ヒット数はルールごとに返る。**1つでも欠けていると合計は足りない**のに、
 * `?? 0` で埋めて足すと、実測より小さい数を実測として読ませることになる。
 * 「未ヒット」に混ざると、当たっているかもしれないルールが**消してよいもの**
 * として並ぶ。
 */
describe('ヒット数の未取得', () => {
  it('数が無いときは — にする', () => {
    expect(metricWord('ready', null)).toBe('—')
  })

  it('読めた 0 は 0 のまま出す', () => {
    /* 「一度も当たらなかった」は事実。`—` にすると分からなくなる。 */
    expect(metricWord('ready', 0)).toBe('0')
  })

  it('読み込み中・失敗のときは、数を出さない', () => {
    for (const state of ['loading', 'error', 'forbidden'] as const) {
      expect(metricWord(state, 12)).toBe('—')
    }
  })
})

/*
 * 一覧の帯・行・絞り込みで未取得を 0 にしない動きは
 * v8/auto-replies/list.test.tsx と list-behavior.test.tsx が描いて確かめる。
 * ここには足りない合計・0 埋めへ戻さない禁止の見張りだけを残す。
 */
describe('一覧の帯と行（設計 8-1 `cmDfJ`）', () => {
  it('ヒット数が1つでも欠けていたら、合計を出さない', () => {
    expect(PAGE, '足りない合計をそのまま出している').not.toContain(
      'const monthlyHits = items.reduce((sum, r) => sum + (r.hits?.period ?? 0), 0)',
    )
  })

  it('行のヒット数を 0 で埋めない', () => {
    expect(PAGE).not.toContain("{r.hits?.period ?? 0}")
  })
})
