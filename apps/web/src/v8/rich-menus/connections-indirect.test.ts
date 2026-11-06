/*
 * 監査 WEB220：直接のタブが無くても、別のメニューを通って行ける・戻れるときは
 * 「つながりなし」「戻りなし」と言わない（A→B→C→A）。
 */
import { describe, expect, it } from 'vitest'
import { analyzeConnections, type ConnectionPage } from './connection-analysis'
import { linkLabel } from './connections'

const page = (id: string, order: number, targets: string[]): ConnectionPage => ({
  id, name: id, orderIndex: order, lineRichmenuId: null,
  areas: targets.map((target) => ({ actionType: 'richmenuswitch', actionData: { targetPageId: target }, label: null })),
})

describe('リッチメニューのつながり（WEB220）', () => {
  it('A→B→C→A なら、B も C もトップへ戻れる', () => {
    const analysis = analyzeConnections([page('A', 0, ['B']), page('B', 1, ['C']), page('C', 2, ['A'])], 'A')
    expect(linkLabel(analysis, 'A', 'B').label).toBe('タブB → 経由して戻れる')
    expect(linkLabel(analysis, 'A', 'C')).toEqual({ label: 'タブA → トップ', both: false })
  })

  it('本当にどこからも行けないなら「つながりなし」（対照）', () => {
    const analysis = analyzeConnections([page('A', 0, []), page('B', 1, [])], 'A')
    expect(linkLabel(analysis, 'A', 'B').label).toBe('つながりなし')
  })
})
