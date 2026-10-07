// @vitest-environment happy-dom
/*
 * 並べ替えの付いてくる動き（フルード ②）：引きずっている間、通った行の位置へ入れ替えて見せる。
 * 自分の上を通っても戻らない（行がずれて往復しない）。離す先は見せていた位置の行。
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useLiveReorder } from './use-live-reorder'

const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

describe('useLiveReorder', () => {
  it('通った行の位置へ入れ替えて見せ、離す先はその行。自分の上は無視する', () => {
    const view = renderHook(({ dragId }) => useLiveReorder(rows, (row) => row.id, dragId), { initialProps: { dragId: null as string | null } })
    expect(view.result.current.shown.map((row) => row.id).join('')).toBe('abcd')
    view.rerender({ dragId: 'a' })
    act(() => view.result.current.enter('c'))
    expect(view.result.current.shown.map((row) => row.id).join('')).toBe('bcad')
    act(() => view.result.current.enter('a'))
    expect(view.result.current.shown.map((row) => row.id).join('')).toBe('bcad')
    expect(view.result.current.dropTarget('a')).toBe('c')
    view.rerender({ dragId: null })
    expect(view.result.current.shown.map((row) => row.id).join('')).toBe('abcd')
  })
})
