// @vitest-environment happy-dom
/*
 * 並び替えの共通部品（ReorderHandle・useReorder）と、旧名（DragHandle・ReorderGrip）。
 * V8：動かせない時はつまみを出さず理由を言う。v7（ReorderGrip）：薄いつまみのまま。
 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ReorderHandle, { moveIdTo, useReorder, type ReorderChange } from './reorder-handle'
import { DragHandle } from './row-actions'
import ReorderGrip from '@/components/friend-fields/reorder-grip'

afterEach(cleanup)

describe('ReorderHandle', () => {
  it('上下キーで1つずつ動かす', () => {
    const onMove = vi.fn()
    render(<ReorderHandle label="A" onMove={onMove} />)
    const handle = screen.getByRole('button', { name: 'Aを並び替え。上下キーで移動' })
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(onMove.mock.calls).toEqual([[-1], [1]])
    expect(handle.getAttribute('data-roving-own')).toBe('vertical')
  })

  it('動かせない時はつまみを出さず、理由を title と読み上げで言う', () => {
    const onMove = vi.fn()
    const view = render(<ReorderHandle label="A" onMove={onMove} disabledReason="検索を外すと動かせます" />)
    expect(screen.queryByRole('button')).toBeNull()
    const slot = view.container.querySelector('[data-reorder-disabled]')!
    expect(slot.getAttribute('title')).toBe('検索を外すと動かせます')
    expect(slot.textContent).toBe('Aは並び替えできません。検索を外すと動かせます')
  })

  it('旧 ReorderGrip（v7）は、動かせない時に薄いつまみを出す（見た目を変えない）', () => {
    const view = render(<ReorderGrip label="A" disabled onMove={() => {}} />)
    expect(screen.queryByRole('button')).toBeNull()
    const dim = view.container.querySelector('span.cursor-not-allowed')
    expect(dim).toBeTruthy()
    expect(dim?.querySelector('svg')).toBeTruthy()
    expect(view.container.querySelector('[data-reorder-disabled]')).toBeNull()
  })

  it('旧 DragHandle は名前をそのまま読み上げと title に使い、渡したキー操作も動く', () => {
    const onKeyDown = vi.fn()
    render(<DragHandle label="「質問」を並べ替える" onKeyDown={onKeyDown} />)
    const handle = screen.getByRole('button', { name: '「質問」を並べ替える' })
    expect(handle.getAttribute('title')).toBe('「質問」を並べ替える')
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(onKeyDown).toHaveBeenCalledTimes(1)
  })
})

describe('moveIdTo', () => {
  it('1つを指定の位置へ動かす。動かないときは null', () => {
    expect(moveIdTo(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a'])
    expect(moveIdTo(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b'])
    expect(moveIdTo(['a', 'b', 'c'], 'a', 0)).toBeNull()
    expect(moveIdTo(['a', 'b', 'c'], 'a', 3)).toBeNull()
    expect(moveIdTo(['a', 'b', 'c'], 'x', 1)).toBeNull()
  })
})

function List({ disabledReason, onReorder }: { disabledReason?: string | null; onReorder: (change: ReorderChange) => void }) {
  const items = ['a', 'b', 'c']
  const reorder = useReorder({ items, idOf: (id) => id, disabledReason, onReorder })
  return (
    <ul>
      {reorder.shown.map((id) => (
        <li key={id} {...reorder.rowProps(id)}>
          <ReorderHandle label={id} {...reorder.handle(id)} {...reorder.handleProps(id)} />
          {reorder.menuItems(id).map((item) => (
            <button key={item.id} type="button" disabled={item.disabled} onClick={item.onSelect}>{`${id}:${item.label}`}</button>
          ))}
        </li>
      ))}
    </ul>
  )
}

describe('useReorder', () => {
  it('ドラッグ・上下キー・上へ／下へは同じ入口（同じ並び）を通る', () => {
    const changes: ReorderChange[] = []
    const view = render(<List onReorder={(change) => changes.push(change)} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'aを並び替え。上下キーで移動' }), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('button', { name: 'a:下へ' }))
    const target = view.container.querySelector<HTMLElement>('[data-reorder-id="b"]')!
    fireEvent.dragStart(screen.getByRole('button', { name: 'aを並び替え。上下キーで移動' }))
    fireEvent.dragEnter(target)
    fireEvent.dragOver(target)
    fireEvent.drop(target)
    expect(changes.map((change) => [change.via, change.ids])).toEqual([
      ['key', ['b', 'a', 'c']],
      ['menu', ['b', 'a', 'c']],
      ['drag', ['b', 'a', 'c']],
    ])
    expect(screen.getByRole('button', { name: 'a:上へ' }).hasAttribute('disabled')).toBe(true)
  })

  it('動かせない時は、つまみ・上へ／下へを出さず、ドラッグも受けない', () => {
    const onReorder = vi.fn()
    const view = render(<List disabledReason="閲覧のみ" onReorder={onReorder} />)
    expect(view.container.querySelector('[data-reorder-handle]')).toBeNull()
    expect(screen.queryByRole('button', { name: /下へ/ })).toBeNull()
    expect(view.container.querySelector('[draggable="true"]')).toBeNull()
    expect(onReorder).not.toHaveBeenCalled()
  })
})
