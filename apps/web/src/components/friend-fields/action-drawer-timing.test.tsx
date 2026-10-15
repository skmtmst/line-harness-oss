// @vitest-environment happy-dom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LinkedActionList from './linked-action-list'
import type { LinkedAction } from './tag-editor-v4'

afterEach(cleanup)

const second: LinkedAction = { id: 'action-b', type: 'テキスト送信', label: '二通目', timing: 'すぐに', definition: { id: 'action-b', type: 'send_message', params: { content: '二通目', delayMinutes: 0, cancelIfTagRemoved: true }, onFailure: 'stop' } }

function openList(initial: LinkedAction[] = []) {
  const onChange = vi.fn()
  function Harness() {
    const [value, setValue] = useState(initial)
    return <LinkedActionList value={value} onChange={next => { setValue(next); onChange(next) }} accountId={null} />
  }
  render(<Harness />)
  return onChange
}

function addText(buttonName = '行うことを足す') {
  fireEvent.click(screen.getByRole('button', { name: buttonName, exact: true }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'テキストを送る' }))
}

describe('現役V8の連動アクションの実行タイミング', () => {
  it('即時実行を遅延0とタグ解除時の中止で追加する', () => {
    const onChange = openList()
    addText()
    expect(onChange.mock.lastCall?.[0][0]).toMatchObject({ timing: 'すぐに', definition: { params: { delayMinutes: 0, cancelIfTagRemoved: true } } })
    expect((screen.getByLabelText('実行までの分数') as HTMLInputElement).value).toBe('0')
  })

  it('行内で待ち時間を編集して保存し、0分へ戻すと即時実行になる', () => {
    const onChange = openList()
    addText()
    fireEvent.change(screen.getByLabelText('実行までの分数'), { target: { value: '5' } })
    expect(onChange.mock.lastCall?.[0][0]).toMatchObject({ timing: '5分後', definition: { params: { delayMinutes: 5, cancelIfTagRemoved: true } } })
    fireEvent.change(screen.getByLabelText('実行までの分数'), { target: { value: '0' } })
    expect(onChange.mock.lastCall?.[0][0]).toMatchObject({ timing: 'すぐに', definition: { params: { delayMinutes: 0, cancelIfTagRemoved: true } } })
  })

  it('待機中にタグが外れた場合の説明は「？」を開くと読める', () => {
    openList()
    addText()
    expect(screen.queryByRole('note')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '実行するタイミングの説明' }))
    expect(screen.getByRole('note').textContent).toContain('待機中にタグが外れた場合は実行されません。')
  })
})

it('選択した行の前へ追加し、元の行とその保存内容を保つ（WEB276）', () => {
  const onChange = openList([second])
  fireEvent.click(screen.getByRole('button', { name: '二通目', exact: true }))
  addText('この行の前に行うことを足す')
  const next = onChange.mock.lastCall?.[0] as LinkedAction[]
  expect(next).toHaveLength(2)
  expect(next[0].definition?.type).toBe('send_message')
  expect(next[0].id).not.toBe('action-b')
  expect(next[1]).toEqual(second)
  expect(screen.getAllByRole('button', { name: /つ目の行うことを並べ替える/ })).toHaveLength(2)
})
