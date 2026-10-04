// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { moveItemWithinGroup, type FeatureGroup, type MenuItemOrder } from '@/lib/feature-settings'
import { ReorderDialog } from './feature-settings-v8'

afterEach(() => cleanup())

const GROUPS: FeatureGroup[] = [
  {
    id: 'g1',
    label: 'まとめる',
    items: [
      { id: 'a', label: 'あ', note: '', keys: [] },
      { id: 'b', label: 'い', note: '', keys: [] },
    ],
  },
]
const ORDER: MenuItemOrder = { g1: ['a', 'b'] }
const move = (order: MenuItemOrder, groupId: string, itemId: string, direction: -1 | 1): MenuItemOrder => ({
  ...order,
  [groupId]: moveItemWithinGroup(order[groupId] ?? [], itemId, direction),
})

/*
 * V8 QA 1003-1459 ③：設定の「並びを変える」の窓が Esc で閉じない。
 * 手書きの窓に共通の窓の振る舞い（Esc・Tabの閉じ込め）を付ける。
 */
describe('並びを変えるの窓', () => {
  it('Escで閉じる', () => {
    const onCancel = vi.fn()
    render(
      <ReorderDialog
        groups={GROUPS}
        initialOrder={ORDER}
        onCancel={onCancel}
        onApply={vi.fn()}
        moveItemInOrder={move}
      />,
    )
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('キャンセルでも閉じる（今までどおり）', () => {
    const onCancel = vi.fn()
    render(
      <ReorderDialog
        groups={GROUPS}
        initialOrder={ORDER}
        onCancel={onCancel}
        onApply={vi.fn()}
        moveItemInOrder={move}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
