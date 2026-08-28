import { describe, expect, it } from 'vitest'
import { analyzeConnections, type ConnectionPage } from './connection-analysis'

function page(id: string, targets: Array<string | null> = []): ConnectionPage {
  return {
    id,
    name: id,
    orderIndex: Number(id.replace(/\D/g, '')) || 0,
    lineRichmenuId: null,
    areas: targets.map((target, index) => ({
      actionType: 'richmenuswitch',
      actionData: target ? { targetPageId: target } : {},
      label: `切替${index + 1}`,
    })),
  }
}

describe('リッチメニューの切替つながり', () => {
  it('入口から進めて戻れるページを安全と判定する', () => {
    const result = analyzeConnections([page('p1', ['p2']), page('p2', ['p1'])], 'p1')
    expect([...result.reachablePageIds]).toEqual(['p1', 'p2'])
    expect([...result.returnablePageIds]).toEqual(['p1', 'p2'])
    expect(result.unreachablePageIds.size).toBe(0)
    expect(result.cannotReturnPageIds.size).toBe(0)
  })

  it('入口から進めないページを分ける', () => {
    const result = analyzeConnections([page('p1'), page('p2', ['p1'])], 'p1')
    expect([...result.unreachablePageIds]).toEqual(['p2'])
  })

  it('進めても入口へ戻れないページを分ける', () => {
    const result = analyzeConnections([page('p1', ['p2']), page('p2')], 'p1')
    expect([...result.cannotReturnPageIds]).toEqual(['p2'])
  })

  it('削除済みまたは未指定の行き先を0件扱いにしない', () => {
    const result = analyzeConnections([page('p1', ['deleted', null])], 'p1')
    expect(result.missingTargetEdges).toHaveLength(2)
    expect(result.missingTargetEdges[0]?.targetPageId).toBe('deleted')
    expect(result.missingTargetEdges[1]?.targetPageId).toBeNull()
  })

  it('自分自身だけを回るページを検知する', () => {
    const result = analyzeConnections([page('p1', ['p1'])], 'p1')
    expect([...result.selfOnlyPageIds]).toEqual(['p1'])
  })
})
