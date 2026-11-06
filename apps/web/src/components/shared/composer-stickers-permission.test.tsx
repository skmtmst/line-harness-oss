// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
const held = vi.hoisted(() => ({ input: new Map<string, NonNullable<ComponentProps<typeof import('./text-field').TextField>['onChange']>>() }))
vi.mock('./text-field', async original => {
  const actual = await original<typeof import('./text-field')>()
  return { ...actual, TextField: (p: ComponentProps<typeof actual.TextField>) => { if (p.onChange) held.input.set(String(p.value), p.onChange); return <actual.TextField {...p} /> } }
})
import ComposerStickers from './composer-stickers'
const value = { packageId: '446', stickerId: '1988' }
const reason = '閲覧のみのためスタンプを変えられません。'
const tile = (id = '1988') => screen.getByRole('button', { name: `スタンプ ${id}`, exact: true }) as HTMLButtonElement
const mode = () => fireEvent.click(screen.getByRole('button', { name: '番号を直接入れる' }))
const changeInput = (value: string) => ({ target: { value } }) as Parameters<NonNullable<ComponentProps<typeof import('./text-field').TextField>['onChange']>>[0]
beforeEach(() => held.input.clear())
afterEach(cleanup)

it('未指定はpack/番号の閲覧を残し、確定と手入力を従来どおり渡す', () => {
  const change = vi.fn(); render(<ComposerStickers value={value} onChange={change} />)
  expect(tile().getAttribute('aria-pressed')).toBe('true'); fireEvent.click(tile('1989'))
  expect(change).toHaveBeenCalledExactlyOnceWith({ packageId: '446', stickerId: '1989' })
  mode(); fireEvent.change(screen.getByLabelText('パッケージID'), { target: { value: '789' } }); fireEvent.change(screen.getByLabelText('スタンプID'), { target: { value: '10855' } })
  expect(change.mock.calls).toEqual([[{ packageId: '446', stickerId: '1989' }], [{ packageId: '789', stickerId: '1988' }], [{ packageId: '446', stickerId: '10855' }]])
})

it('既知の理由は元の選択と図柄を保ち、Tab対象・理由1つ・変更0', () => {
  const change = vi.fn(); render(<ComposerStickers value={value} onChange={change} lockedReason={reason} canChangeNow={() => false} />)
  const selected = tile(); expect(selected.getAttribute('aria-pressed')).toBe('true'); expect(selected.disabled).toBe(false); expect(selected.tabIndex).toBe(0); expect(selected.getAttribute('aria-disabled')).toBe('true')
  fireEvent.focus(selected); expect(screen.getAllByRole('tooltip')).toHaveLength(1); expect(screen.getByRole('tooltip').textContent).toBe(reason)
  fireEvent.click(selected); fireEvent.keyDown(selected, { key: 'Enter' }); fireEvent.keyDown(selected, { key: ' ' }); expect(change).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'サリー' })); expect(tile('10855')).toBeTruthy(); expect(change).not.toHaveBeenCalled()
})

it('未知は普通disabled/理由なしで、packと番号の閲覧は残す', () => {
  const change = vi.fn(); render(<ComposerStickers value={value} onChange={change} canChangeNow={() => false} />)
  expect(tile().disabled).toBe(true); expect(document.querySelector('[data-permission-locked]')).toBeNull(); expect(screen.queryByRole('tooltip')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'サリー' })); expect(tile('10855').disabled).toBe(true)
  mode(); expect((screen.getByLabelText('パッケージID') as HTMLInputElement).disabled).toBe(true); expect((screen.getByLabelText('スタンプID') as HTMLInputElement).disabled).toBe(true)
  act(() => held.input.get('446')!(changeInput('789'))); expect(change).not.toHaveBeenCalled(); expect(document.querySelector('[data-permission-locked]')).toBeNull()
})

it('tileは再描画する前の失効でも変更0、許可中の新操作は1', () => {
  let allowed = true; const change = vi.fn(); render(<ComposerStickers value={value} onChange={change} canChangeNow={() => allowed} />)
  allowed = false; fireEvent.click(tile('1989')); expect(change).not.toHaveBeenCalled()
  allowed = true; fireEvent.click(tile('1989')); expect(change).toHaveBeenCalledExactlyOnceWith({ packageId: '446', stickerId: '1989' })
})

it('番号の保持handlerは新callbackの描画後失効を読む', () => {
  let latestAllowed = true; const change = vi.fn(); const view = render(<ComposerStickers value={value} onChange={change} canChangeNow={() => true} />); mode(); const old = held.input.get('446')!
  view.rerender(<ComposerStickers value={value} onChange={change} canChangeNow={() => latestAllowed} />); latestAllowed = false
  act(() => old(changeInput('789'))); expect(change).not.toHaveBeenCalled()
})

it('理由付きの番号handlerは理由が外れても復活せず、新操作は1', () => {
  const change = vi.fn(); const view = render(<ComposerStickers value={value} onChange={change} lockedReason={reason} canChangeNow={() => true} />); mode(); const old = held.input.get('446')!
  expect((screen.getByLabelText('パッケージID') as HTMLInputElement).disabled).toBe(true)
  const group = screen.getByRole('group', { name: 'スタンプの番号' }); expect(group.tabIndex).toBe(0); fireEvent.focus(group); expect(screen.getAllByRole('tooltip')).toHaveLength(1); expect(screen.getByRole('tooltip').textContent).toBe(reason)
  view.rerender(<ComposerStickers value={value} onChange={change} canChangeNow={() => true} />)
  act(() => old(changeInput('789'))); expect(change).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('パッケージID'), { target: { value: '789' } }); expect(change).toHaveBeenCalledExactlyOnceWith({ packageId: '789', stickerId: '1988' })
})

it('callback拒否時に保持した番号handlerは許可へ戻しても0、画像失敗時はIDを読める', () => {
  const change = vi.fn(); const view = render(<ComposerStickers value={value} onChange={change} canChangeNow={() => false} />)
  fireEvent.error(screen.getByAltText('スタンプ 1988')); expect(tile().textContent).toBe('1988'); mode(); const old = held.input.get('1988')!
  view.rerender(<ComposerStickers value={value} onChange={change} canChangeNow={() => true} />)
  act(() => old(changeInput('1989'))); expect(change).not.toHaveBeenCalled(); fireEvent.change(screen.getByLabelText('スタンプID'), { target: { value: '1989' } }); expect(change).toHaveBeenCalledOnce()
})

it('明示disabledもcallback許可とは別に止め、理由を作らない', () => {
  const change = vi.fn(); render(<ComposerStickers value={value} onChange={change} disabled canChangeNow={() => true} />)
  expect(tile().disabled).toBe(true); fireEvent.click(tile()); mode()
  expect((screen.getByLabelText('パッケージID') as HTMLInputElement).disabled).toBe(true); act(() => held.input.get('446')!(changeInput('789')))
  expect(change).not.toHaveBeenCalled(); expect(document.querySelector('[data-permission-locked]')).toBeNull()
})
