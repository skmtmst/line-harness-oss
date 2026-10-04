import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./line-followup.tsx', import.meta.url), 'utf8')

/* 板 `xLpnS`：LINE来店フォローは V8 だけで出す。v7 console は使わない。 */
describe('LINE来店フォロー V8（板 xLpnS）', () => {
  it('外枠に板の印を付ける', () => {
    expect(PAGE).toContain('boardId="xLpnS"')
  })

  it('データの口は今のまま（lineFlows の読み・updateLineFlow の保存）', () => {
    expect(PAGE).toContain('data.lineFlows')
    expect(PAGE).toContain('restaurantTestApi.updateLineFlow')
  })

  it('本送信は押せないまま置く（プレビューのみ）', () => {
    expect(PAGE).toContain("label=\"本送信\"")
    expect(PAGE).toContain('プレビューのみ')
  })
})
