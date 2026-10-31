// @vitest-environment happy-dom
import { createRef } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AffixedTextField, TextArea, TextField } from './text-field'
import { Field } from './form-controls'

afterEach(cleanup)
const reason = 'この設定を変える権限がありません。'
const variants = [TextField, TextArea, AffixedTextField] as const
const propsOf = (node: HTMLElement) => (node as unknown as Record<string, Record<string, (event: unknown) => void>>)[Object.keys(node).find(key => key.startsWith('__reactProps$'))!]

it.each(variants)('%sは同じ欄と値を残し、理由へ焦点を当てても変更しない', Control => {
  const change = vi.fn(), input = vi.fn(), focus = vi.fn(), blur = vi.fn(), click = vi.fn()
  render(<Control aria-label="内容" value="保存した内容" onChange={change} onInput={input} onFocus={focus} onBlur={blur} onClick={click} lockedReason={reason} />)
  const field = screen.getByRole('textbox') as HTMLInputElement
  expect(field.value).toBe('保存した内容')
  expect(field.disabled).toBe(false)
  expect(field.readOnly).toBe(true)
  expect(field.tabIndex).toBe(0)
  expect(field.getAttribute('aria-disabled')).toBe('true')
  expect(field.hasAttribute('data-no-name-tip')).toBe(true)
  fireEvent.change(field, { target: { value: '書き換え' } }); fireEvent.input(field); fireEvent.click(field)
  expect(change).not.toHaveBeenCalled(); expect(input).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled()
  act(() => field.focus()); expect(screen.getByRole('tooltip').textContent).toBe(reason); expect(focus).toHaveBeenCalledOnce()
  act(() => field.blur()); expect(blur).toHaveBeenCalledOnce()
})

it.each(variants)('%sの未指定は普通の入力とdisabledのまま', Control => {
  const change = vi.fn()
  const view = render(<Control aria-label="内容" defaultValue="元の内容" onChange={change} />)
  const field = screen.getByRole('textbox') as HTMLInputElement
  expect(field.readOnly).toBe(false)
  expect(field.hasAttribute('aria-disabled')).toBe(false)
  fireEvent.change(field, { target: { value: '新しい内容' } }); expect(change).toHaveBeenCalledOnce()
  view.rerender(<Control aria-label="内容" defaultValue="元の内容" onChange={change} disabled />)
  expect(field.disabled).toBe(true); expect(field.readOnly).toBe(false)
  expect(document.querySelector('[data-permission-locked]')).toBeNull()
})

it.each(variants)('%sは本人未知を理由なしdisabledにし、保持した変更も拒否する', Control => {
  const change = vi.fn(), input = vi.fn()
  const view = render(<Control aria-label="内容" value="残す" onChange={change} onInput={input} canChangeNow={() => true} />)
  const field = screen.getByRole('textbox'), old = propsOf(field)
  view.rerender(<Control aria-label="内容" value="残す" onChange={change} onInput={input} canChangeNow={() => false} />)
  expect((field as HTMLInputElement).disabled).toBe(true)
  expect(document.querySelector('[data-permission-locked]')).toBeNull()
  act(() => { old.onChange({}); old.onInput({}) })
  expect(change).not.toHaveBeenCalled(); expect(input).not.toHaveBeenCalled()
})

it.each(variants)('%sは最新callbackの拒否と描画時の拒否の両方を見る', Control => {
  const change = vi.fn(); let allowed = true
  const view = render(<Control aria-label="内容" value="残す" onChange={change} canChangeNow={() => allowed} />)
  const field = screen.getByRole('textbox'), old = propsOf(field).onChange
  allowed = false; act(() => old({})); expect(change).not.toHaveBeenCalled()
  view.rerender(<Control aria-label="内容" value="残す" onChange={change} lockedReason={reason} canChangeNow={() => true} />)
  const denied = propsOf(field).onChange
  view.rerender(<Control aria-label="内容" value="残す" onChange={change} canChangeNow={() => true} />)
  act(() => denied({})); expect(change).not.toHaveBeenCalled()
  fireEvent.change(field, { target: { value: '正規の編集' } }); expect(change).toHaveBeenCalledOnce()
  const beforeUnmount = propsOf(field).onChange; view.unmount(); act(() => beforeUnmount({})); expect(change).toHaveBeenCalledOnce()
})

it('外の説明・Fieldの説明・理由を残し、読むキーとrefをつなぐ', () => {
  const ref = createRef<HTMLInputElement>(), keyboard = vi.fn()
  render(<><p id="outside">外の説明</p><Field label="名前" note="元の説明"><TextField ref={ref} aria-describedby="outside" value="保存値" lockedReason={reason} onKeyDown={keyboard} /></Field></>)
  const input = screen.getByRole('textbox') as HTMLInputElement
  expect(ref.current).toBe(input)
  const notes = input.getAttribute('aria-describedby')!.split(' ').map(id => document.getElementById(id)?.textContent)
  expect(notes).toContain('外の説明'); expect(notes).toContain('元の説明'); expect(notes.filter(note => note === reason)).toHaveLength(1)
  expect(fireEvent.keyDown(input, { key: 'c', ctrlKey: true })).toBe(true); expect(keyboard).toHaveBeenCalledOnce()
  expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false); expect(keyboard).toHaveBeenCalledOnce()
})

it.each(variants)('%sは理由を外すと元のinnerHTMLへ1文字も変えず戻る', Control => {
  const draw = (lockedReason?: string) => <Control id="saved-content" aria-label="内容" value="保存した内容" lockedReason={lockedReason} />
  const view = render(draw())
  const initialHTML = view.container.innerHTML
  expect(view.container.children).toHaveLength(1)
  expect(view.container.firstElementChild?.tagName).toBe(Control === TextArea ? 'TEXTAREA' : Control === AffixedTextField ? 'SPAN' : 'INPUT')
  view.rerender(draw(reason)); expect(view.container.querySelector('[data-permission-locked]')).not.toBeNull()
  view.rerender(draw()); expect(view.container.innerHTML).toBe(initialHTML)
})

it.each([TextField, TextArea])('%sの理由付きでもIME確定Enterは通常のEnterへ渡さない', Control => {
  const enter = vi.fn(), parent = vi.fn(), change = vi.fn()
  render(<div onKeyDown={parent}><Control aria-label="内容" value="確定前の本文" lockedReason={reason} onKeyDown={enter} onChange={change} /></div>)
  const field = screen.getByRole('textbox')
  expect(fireEvent.keyDown(field, { key: 'Enter', isComposing: true })).toBe(true)
  expect(fireEvent.keyDown(field, { key: 'Enter', keyCode: 229 })).toBe(true)
  expect(enter).not.toHaveBeenCalled(); expect(parent).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled()
  expect(fireEvent.keyDown(field, { key: 'Enter' })).toBe(false)
})
