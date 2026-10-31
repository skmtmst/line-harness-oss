// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import RadioCard, { RadioCardGroup, type RadioCardProps } from './radio-card'
import { Field } from './form-controls'

afterEach(cleanup)
const reason = 'この操作はオーナーか管理者だけができます。'

it.each(['card', 'row', 'compact', 'form'] as const)('理由付き%sは選択を残し、カード/入力の押下を拒み、焦点で共通の理由を示す', variant => {
  const change = vi.fn(), click = vi.fn()
  render(<RadioCard name="locked" value="a" checked onChange={change} onClick={click} title="選択済み" variant={variant} lockedReason={reason} />)
  const input = screen.getByRole('radio') as HTMLInputElement
  const label = input.closest('label')!
  expect(input.checked).toBe(true)
  expect(input.disabled).toBe(false)
  expect(input.tabIndex).toBe(0)
  expect(input.getAttribute('aria-disabled')).toBe('true')
  expect(label.hasAttribute('data-permission-locked')).toBe(true)
  expect(label.hasAttribute('data-no-name-tip')).toBe(true)
  fireEvent.click(input)
  fireEvent.click(screen.getByText('選択済み'))
  fireEvent.doubleClick(label)
  expect(change).not.toHaveBeenCalled()
  expect(click).not.toHaveBeenCalled()
  act(() => input.focus())
  expect(document.activeElement).toBe(input)
  expect(screen.getByRole('tooltip').textContent).toBe(reason)
  expect(input.checked).toBe(true)
})

it.each(['Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])('理由付きの%sは既定の選択と呼ぶ側の起動を止める', key => {
  const change = vi.fn(), keyboard = vi.fn()
  render(<RadioCard name="locked" value="a" checked={false} onChange={change} onKeyDown={keyboard} title="選ぶ" lockedReason={reason} />)
  expect(fireEvent.keyDown(screen.getByRole('radio'), { key })).toBe(false)
  expect(change).not.toHaveBeenCalled()
  expect(keyboard).not.toHaveBeenCalled()
})

it('changeを直接受けても値の変更を拒み、読む側のキーはつなぐ', () => {
  const change = vi.fn(), keyboard = vi.fn()
  render(<RadioCard name="locked" value="a" checked={false} onChange={change} onKeyDown={keyboard} title="選ぶ" lockedReason={reason} />)
  const input = screen.getByRole('radio')
  // labelのclick阻止とは別に、Reactが受け取ったchangeの守りを確認する。
  const propsKey = Object.keys(input).find(key => key.startsWith('__reactProps$'))!
  const props = (input as unknown as Record<string, { onChange: () => void }>)[propsKey]
  act(() => props.onChange())
  expect(change).not.toHaveBeenCalled()
  expect(fireEvent.keyDown(input, { key: 'Escape' })).toBe(true)
  expect(keyboard).toHaveBeenCalledTimes(1)
})

it('入力の説明を残して理由だけを1つ結び、入力不足の理由と二重にしない', () => {
  render(<Field label="方法" note="元の欄の説明"><RadioCard name="a" value="a" checked onChange={vi.fn()} title="保存済み" disabled disabledReason="接続後に使えます" lockedReason={reason} indicator="check" /></Field>)
  const input = screen.getByRole('radio') as HTMLInputElement
  const notes = input.getAttribute('aria-describedby')!.split(' ').map(id => document.getElementById(id)?.textContent)
  expect(notes).toEqual([reason, '元の欄の説明'])
  expect(screen.queryByText('接続後に使えます')).toBeNull()
  expect(input.disabled).toBe(false)
  expect(input.closest('label')!.querySelector('[data-choice-check]')).not.toBeNull()
})

it('理由なしのdisabledは未知の本人の普通のdisabledのまま、permissionの印も理由もない', () => {
  render(<RadioCard name="unknown" value="a" checked onChange={vi.fn()} title="確認中" disabled />)
  const input = screen.getByRole('radio') as HTMLInputElement
  expect(input.disabled).toBe(true)
  expect(input.hasAttribute('aria-disabled')).toBe(false)
  expect(input.closest('label')!.hasAttribute('data-permission-locked')).toBe(false)
  expect(screen.queryByRole('tooltip')).toBeNull()
})

it('理由を足しても選択を失わず、外すと元のDOMと再選択の操作へ戻る', () => {
  const change = vi.fn(), click = vi.fn()
  const draw = (lockedReason?: string) => <RadioCardGroup legend="方法"><RadioCard name="a" value="a" checked onChange={change} onClick={click} title="最初の選択" lockedReason={lockedReason} /></RadioCardGroup>
  const { rerender, container } = render(draw())
  const initial = container.innerHTML
  rerender(draw(reason))
  const input = screen.getByRole('radio') as HTMLInputElement
  expect(input.checked).toBe(true)
  fireEvent.click(input)
  expect(click).not.toHaveBeenCalled()
  rerender(draw())
  expect(container.innerHTML).toBe(initial)
  fireEvent.click(screen.getByText('最初の選択'))
  expect(click).toHaveBeenCalled()
})

it('hoverとtouchでも同じ理由だけが出て、選ぶ処理は呼ばない', () => {
  const change = vi.fn()
  render(<RadioCard name="a" value="a" checked={false} onChange={change} title="選ぶ" lockedReason={reason} />)
  const label = screen.getByRole('radio').closest('label')!
  fireEvent.pointerEnter(label, { pointerType: 'mouse' })
  expect(screen.getByRole('tooltip').textContent).toBe(reason)
  fireEvent.pointerLeave(label, { pointerType: 'mouse' })
  expect(screen.queryByRole('tooltip')).toBeNull()
  fireEvent.pointerDown(label, { pointerType: 'touch' })
  expect(screen.getByRole('tooltip').textContent).toBe(reason)
  expect(change).not.toHaveBeenCalled()
})

// 既存の公開型を受ける呼び出し側へ理由を渡せることも型検査の対象にする。
const typedPermission: RadioCardProps['lockedReason'] = reason
void typedPermission
