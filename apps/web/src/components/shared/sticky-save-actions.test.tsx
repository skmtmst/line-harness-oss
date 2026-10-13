// @vitest-environment happy-dom
import React, { createRef } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ArrowRight, Check, Save, Upload } from 'lucide-react'
import Button from './button'
import StickyBar from './sticky-bar'

afterEach(() => { cleanup(); vi.useRealTimers() })

it.each(['保存する', '登録して紹介リンクを発行する', 'つくって動かす', '有効にする', 'タグを作る'])('主操作「%s」は共通の保存印と元の文字を持つ', label => {
  render(<StickyBar actions={<><div><Button variant="primary"><span><Check size={15} aria-hidden="true" /><strong>{label}</strong></span></Button></div></>} />)
  const button = screen.getByRole('button', { name: label })
  expect(button.querySelectorAll('svg')).toHaveLength(1)
  expect(button.querySelector('svg')?.classList.contains('lucide-save')).toBe(true)
  expect(button.querySelector('strong')?.textContent).toBe(label)
})

it('印なしと既存の保存印も1つにそろえる', () => {
  render(<StickyBar actions={<><Button variant="primary">保存する</Button><Button variant="primary"><Save aria-hidden="true" />変更を保存</Button></>} />)
  for (const button of screen.getAllByRole('button')) expect(button.querySelectorAll('svg.lucide-save')).toHaveLength(1)
})

it('次へ・副操作・リンク・左端の操作の印はその役目を保つ', () => {
  render(<StickyBar destructive={<Button variant="danger"><Upload aria-hidden="true" />削除する</Button>} actions={<>
    <Button variant="primary"><ArrowRight aria-hidden="true" />次へ</Button>
    <Button><Check aria-hidden="true" />下書きを保存</Button>
    <Button variant="primary" href="/templates"><ArrowRight aria-hidden="true" />保存した物を開く</Button>
  </>} />)
  expect(screen.getByRole('button', { name: '次へ' }).querySelector('svg.lucide-arrow-right')).not.toBeNull()
  expect(screen.getByRole('button', { name: '下書きを保存' }).querySelector('svg.lucide-check')).not.toBeNull()
  expect(screen.getByRole('button', { name: '削除する' }).querySelector('svg.lucide-upload')).not.toBeNull()
  expect(screen.getByRole('link').querySelector('svg.lucide-arrow-right')).not.toBeNull()
})

it('ref・submit・理由・押下は保ち、disabledとbusyでは実行しない', () => {
  const save = vi.fn(), ref = createRef<HTMLButtonElement>()
  const actions = (disabled: boolean, busy: boolean) => <Button ref={ref} type="submit" variant="primary" onClick={save} disabled={disabled} busy={busy} aria-description="内容を確認してください"><Check aria-hidden="true" />保存する</Button>
  const { rerender } = render(<StickyBar actions={actions(false, false)} />)
  const button = screen.getByRole('button')
  expect(ref.current).toBe(button); expect(button.getAttribute('type')).toBe('submit')
  expect(button.getAttribute('aria-description')).toBe('内容を確認してください')
  fireEvent.click(button); expect(save).toHaveBeenCalledTimes(1)
  rerender(<StickyBar actions={actions(true, false)} />); fireEvent.click(button); expect(save).toHaveBeenCalledTimes(1)
  rerender(<StickyBar actions={actions(false, true)} />); fireEvent.click(button); expect(save).toHaveBeenCalledTimes(1)
  expect(button.querySelectorAll('svg')).toHaveLength(1)
  expect(button.querySelector('svg.lucide-loader-circle')).not.toBeNull()
  expect(button.getAttribute('aria-busy')).toBe('true')
})

it('保存中と完了の表示を保ち、完了後に共通の保存印へ戻る', () => {
  vi.useFakeTimers()
  const actions = (done: boolean) => <Button variant="primary" busy={false} done={done}><Check aria-hidden="true" />保存する</Button>
  const { rerender } = render(<StickyBar actions={actions(false)} />)
  const button = screen.getByRole('button')
  rerender(<StickyBar actions={actions(true)} />)
  expect(button.textContent).toBe('保存しました'); expect(button.querySelectorAll('svg')).toHaveLength(1)
  expect(button.querySelector('svg.lucide-check')).not.toBeNull()
  act(() => { vi.advanceTimersByTime(1300) })
  expect(button.textContent).toBe('保存する'); expect(button.querySelector('svg.lucide-save')).not.toBeNull()
})

it('分割した帯も同じ印、インラインの別用途は渡された印を保つ', () => {
  const action = <Button variant="primary"><Check aria-hidden="true" />保存する</Button>
  const { rerender } = render(<StickyBar split={{ trailingWidth: '380px' }} actions={action} />)
  expect(screen.getByRole('button').querySelector('svg.lucide-save')).not.toBeNull()
  rerender(<StickyBar presentation="account-registration" actions={action} />)
  expect(screen.getByRole('button').querySelector('svg.lucide-check')).not.toBeNull()
})
