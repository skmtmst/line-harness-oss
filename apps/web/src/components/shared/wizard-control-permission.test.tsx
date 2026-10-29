// @vitest-environment happy-dom
import { createRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CreateStarterCards } from '@/components/templates/create-parts'
import KeywordInput from './keyword-input'
import { MessageInsertButton } from './message-insert-row'

afterEach(cleanup)
const reason = '閲覧のみのため変更できません。'

it('ひな形の操作は権限理由を持って残り、読む管理リンクは維持、未確定はnative disabled', () => {
  const use = vi.fn()
  const items = [{ key: 'one', name: 'ひな形', lines: ['同じ内容'], onUse: use, lockedReason: reason }]
  const view = render(<CreateStarterCards items={items} manage={<a href="/templates">ひな形を管理</a>} />)
  const button = screen.getByRole('button', { name: 'このひな形を使う' }) as HTMLButtonElement
  expect(button.disabled).toBe(false); expect(button.getAttribute('aria-disabled')).toBe('true')
  fireEvent.focus(button); expect(screen.getByRole('tooltip').textContent).toBe(reason)
  fireEvent.click(button); expect(use).not.toHaveBeenCalled()
  expect(screen.getByRole('link', { name: 'ひな形を管理' }).getAttribute('href')).toBe('/templates')
  view.rerender(<CreateStarterCards items={[{ ...items[0], lockedReason: undefined, disabled: true }]} />)
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
  expect(document.querySelector('[data-permission-locked]')).toBeNull()
  view.rerender(<CreateStarterCards items={[{ ...items[0], lockedReason: undefined }]} />)
  fireEvent.click(screen.getByRole('button')); expect(use).toHaveBeenCalledTimes(1)
})

it('キーワード確定はdisabledへ変わった後のblur/Enterでは起こらず、解除後1回だけ', () => {
  const add = vi.fn()
  const view = render(<KeywordInput id="word" label="言葉" onAdd={add} maxLength={200} />)
  const input = screen.getByRole('textbox', { name: '言葉' }) as HTMLInputElement
  fireEvent.change(input, { target: { value: '保持した入力' } })
  view.rerender(<KeywordInput id="word" label="言葉" onAdd={add} maxLength={200} disabled />)
  expect(input.disabled).toBe(true); expect(input.maxLength).toBe(200)
  fireEvent.blur(input); fireEvent.keyDown(input, { key: 'Enter' }); expect(add).not.toHaveBeenCalled()
  expect(input.value).toBe('保持した入力')
  view.rerender(<KeywordInput id="word" label="言葉" onAdd={add} maxLength={200} />)
  fireEvent.keyDown(input, { key: 'Enter' }); expect(add).toHaveBeenCalledExactlyOnceWith('保持した入力')
})

it('差込の灰色操作は焦点で理由が読め、既存description/refを保ち、起動0→通常1', () => {
  const insert = vi.fn(), ref = createRef<HTMLButtonElement>()
  const view = render(<><span id="help">元の説明</span><MessageInsertButton ref={ref} kind="name" label="名前" onClick={insert} lockedReason={reason} aria-describedby="help" title="元のtitle" /></>)
  const button = screen.getByRole('button', { name: '名前' }) as HTMLButtonElement
  expect(ref.current).toBe(button); expect(button.disabled).toBe(false)
  expect(button.getAttribute('aria-disabled')).toBe('true')
  const ids = button.getAttribute('aria-describedby')!.split(' ')
  expect(ids[0]).toBe('help'); expect(document.getElementById(ids[1])?.textContent).toBe(reason)
  expect(button.getAttribute('title')).toBeNull()
  fireEvent.focus(button); expect(screen.getByRole('tooltip').textContent).toBe(reason)
  fireEvent.click(button); fireEvent.keyDown(button, { key: 'Enter' }); expect(insert).not.toHaveBeenCalled()
  view.rerender(<><span id="help">元の説明</span><MessageInsertButton ref={ref} kind="name" label="名前" onClick={insert} disabled /></>)
  expect(button.disabled).toBe(true); expect(button.hasAttribute('data-permission-locked')).toBe(false)
  view.rerender(<><span id="help">元の説明</span><MessageInsertButton ref={ref} kind="name" label="名前" onClick={insert} /></>)
  fireEvent.click(screen.getByRole('button', { name: '名前' })); expect(insert).toHaveBeenCalledTimes(1)
})
