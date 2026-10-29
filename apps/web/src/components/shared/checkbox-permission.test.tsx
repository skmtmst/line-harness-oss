// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Checkbox from './checkbox'
afterEach(cleanup)
const reason = 'この操作はオーナーか管理者だけができます。'
it.each([false, true])('理由付きのチェック%sは値を残し、焦点で理由を示してclick/change/Space/Enterを拒む', checked => {
  const change = vi.fn()
  render(<><span id="outside">外の説明</span><Checkbox checked={checked} onCheckedChange={change} lockedReason={reason} description="欄の説明" aria-describedby="outside">配信を選ぶ</Checkbox></>)
  const input = screen.getByRole('checkbox', { name: '配信を選ぶ' }) as HTMLInputElement
  expect(input.disabled).toBe(false)
  expect(input.tabIndex).toBe(0)
  expect(input.closest('[data-disabled="true"]')).toBeTruthy()
  expect(input.getAttribute('aria-disabled')).toBe('true')
  const notes = input.getAttribute('aria-describedby')!.split(' ').map(id => document.getElementById(id)?.textContent)
  expect(notes).toEqual(['外の説明', '欄の説明', reason])
  fireEvent.focus(input)
  expect(screen.getByRole('tooltip').textContent).toBe(reason)
  fireEvent.click(input)
  fireEvent.click(screen.getByText('配信を選ぶ'))
  fireEvent.change(input, { target: { checked: !checked } })
  // changeはブラウザ外から直接値を書き換えるため、制御値へ再描画する。
  expect(change).not.toHaveBeenCalled()
  for (const key of [' ', 'Enter']) expect(fireEvent.keyDown(input, { key })).toBe(false)
  expect(change).not.toHaveBeenCalled()
})
it('開いた画面で理由を足しても選択を失わず、理由を外すと元の変更操作へ戻る', () => {
  const change = vi.fn()
  const draw = (lockedReason?: string) => <Checkbox id="choice" checked onCheckedChange={change} lockedReason={lockedReason}>配信を選ぶ</Checkbox>
  const { rerender, container } = render(draw())
  const original = container.innerHTML
  const input = screen.getByRole('checkbox') as HTMLInputElement
  expect(input.hasAttribute('data-permission-locked')).toBe(false)
  expect(input.disabled).toBe(false)
  expect(input.tabIndex).toBe(0)
  fireEvent.click(input)
  expect(change).toHaveBeenCalledExactlyOnceWith(false)
  change.mockClear()
  rerender(draw(reason))
  expect(input.checked).toBe(true)
  fireEvent.click(input); expect(change).not.toHaveBeenCalled()
  rerender(draw())
  expect(container.innerHTML).toBe(original)
  fireEvent.click(input); expect(change).toHaveBeenCalledExactlyOnceWith(false)
})
it('理由なしの普通disabledはnative disabledのままでpermissionの印や理由を増やさない', () => {
  render(<Checkbox checked={false} disabled onCheckedChange={vi.fn()} aria-label="未取得" />)
  const input = screen.getByRole('checkbox') as HTMLInputElement
  expect(input.disabled).toBe(true)
  expect(input.hasAttribute('aria-disabled')).toBe(false)
  expect(input.hasAttribute('data-permission-locked')).toBe(false)
  expect(screen.queryByRole('tooltip')).toBeNull()
})

it('理由付きも焦点・hover・非起動キーは呼ぶ側へつなぎ、click/Enter/Spaceの起動は呼ばない', () => {
  const focus = vi.fn(), blur = vi.fn(), enter = vi.fn(), leave = vi.fn(), key = vi.fn(), click = vi.fn(), change = vi.fn()
  render(<Checkbox checked={false} onCheckedChange={change} lockedReason={reason} onFocus={focus} onBlur={blur} onPointerEnter={enter} onPointerLeave={leave} onKeyDown={key} onClick={click} aria-label="選ぶ" />)
  const input = screen.getByRole('checkbox')
  fireEvent.focus(input); expect(focus).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('tooltip').textContent).toBe(reason)
  fireEvent.pointerEnter(input, { pointerType: 'mouse' }); expect(enter).toHaveBeenCalledTimes(1)
  fireEvent.pointerLeave(input, { pointerType: 'mouse' }); expect(leave).toHaveBeenCalledTimes(1)
  fireEvent.keyDown(input, { key: 'ArrowDown' }); expect(key).toHaveBeenCalledTimes(1)
  fireEvent.click(input); fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.keyDown(input, { key: ' ' })
  expect(click).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled(); expect(key).toHaveBeenCalledTimes(1)
  fireEvent.blur(input); expect(blur).toHaveBeenCalledTimes(1)
})
