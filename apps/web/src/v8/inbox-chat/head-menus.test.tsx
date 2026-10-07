// @vitest-environment happy-dom
/*
 * ★V8 会話の頭（M0393 XqSvX・段2「5. 会話の頭のメニュー」）。
 * - 担当・対応状況は1つだけ選ぶ。四角のチェックボックスは出さない（オーナー指摘）
 * - 担当は名前で探せる。選んでいる行は aria-selected と ✓
 * - メールの会話でも同じ頭：☆と探すは渡したときだけ出る
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ConversationHead from './conversation-head'

beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const operators = [{ id: 'op-k', name: 'Kenta' }, { id: 'op-m', name: 'Masato' }]

function mount(extra: Partial<React.ComponentProps<typeof ConversationHead>> = {}) {
  const onOperator = vi.fn()
  const onStatus = vi.fn()
  render(
    <ConversationHead
      name="坂本 真人"
      sub="メール・発送について"
      operator={{ value: 'op-k', operators, onChange: onOperator }}
      status={{ value: 'unread', onChange: onStatus }}
      {...extra}
    />,
  )
  return { onOperator, onStatus }
}

describe('会話の頭のメニュー', () => {
  test('対応状況は1つだけ選ぶ一覧。チェックボックスは出さず、選ぶと変わる', () => {
    const { onStatus } = mount()
    fireEvent.click(screen.getByRole('button', { name: '対応状況を変える' }))
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    const options = screen.getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['未対応', '対応中', '保留', '対応済み'])
    expect(options[0].getAttribute('aria-selected')).toBe('true')
    fireEvent.click(options[2])
    expect(onStatus).toHaveBeenCalledWith('on_hold')
  })

  test('担当は名前で探せ、選ぶと変わる。未割り当ても選べる', () => {
    const { onOperator } = mount()
    expect(screen.getByRole('button', { name: '担当者を変える' }).textContent).toContain('担当：Kenta')
    fireEvent.click(screen.getByRole('button', { name: '担当者を変える' }))
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    fireEvent.change(screen.getByLabelText('担当者名を検索'), { target: { value: 'mas' } })
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['MMasato'])
    fireEvent.click(screen.getByRole('option'))
    expect(onOperator).toHaveBeenCalledWith('op-m')
  })

  test('メールの会話：名前の下に件名。☆と探すは渡したときだけ', () => {
    mount()
    expect(screen.getByText('メール・発送について')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '注目にする' })).toBeNull()
    expect(screen.queryByRole('button', { name: '会話の中を探す（⌘F）' })).toBeNull()
    cleanup()
    const onToggle = vi.fn()
    mount({ attention: { on: false, saving: false, onToggle }, search: { open: false, onToggle: () => undefined } })
    fireEvent.click(screen.getByRole('button', { name: '注目にする' }))
    expect(onToggle).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '会話の中を探す（⌘F）' })).toBeTruthy()
  })
})
