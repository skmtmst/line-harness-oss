// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActionDrawer } from './tag-editor-v4'

afterEach(cleanup)

function openDrawer() {
  const onAdd = vi.fn()
  render(<ActionDrawer accountId={null} suppliedResources={null} onClose={() => {}} onAdd={onAdd} />)
  return onAdd
}

describe('連動アクションの実行タイミング', () => {
  it('即時実行では待ち時間の欄を出さず、遅延0で追加する', () => {
    const onAdd = openDrawer()
    expect(screen.queryByLabelText('実行までの待ち時間')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'このアクションを追加する' }))
    expect(onAdd.mock.calls[0][0]).toMatchObject({ timing: 'すぐに', definition: { params: { delayMinutes: 0, cancelIfTagRemoved: true } } })
  })

  it('切り替えと矢印キーで待ち時間を選び、入力した時間を保存する', () => {
    const onAdd = openDrawer()
    const timing = screen.getByRole('group', { name: '実行するタイミング' })
    fireEvent.keyDown(within(timing).getByRole('button', { name: 'すぐに実行' }), { key: 'ArrowRight' })
    expect(within(timing).getByRole('button', { name: '時間をあけて実行' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.change(screen.getByLabelText('実行までの待ち時間'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'このアクションを追加する' }))
    expect(onAdd.mock.calls[0][0]).toMatchObject({ timing: '5分後', definition: { params: { delayMinutes: 5, cancelIfTagRemoved: true } } })
    fireEvent.click(within(timing).getByRole('button', { name: 'すぐに実行' }))
    expect(screen.queryByLabelText('実行までの待ち時間')).toBeNull()
  })

  it('待機中にタグが外れた場合の説明は「？」を開くと読める', () => {
    openDrawer()
    expect(screen.queryByRole('note')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '実行するタイミングの説明' }))
    expect(screen.getByRole('note').textContent).toContain('待機中にタグが外れた場合は実行されません。')
  })
})
