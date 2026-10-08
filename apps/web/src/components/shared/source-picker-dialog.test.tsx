// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SourcePickerDialog, { type SourcePickerItem } from './source-picker-dialog'

afterEach(cleanup)
const items: SourcePickerItem[] = [
  { id: '1', name: '春のお知らせ', category: 'message', categoryLabel: 'テキスト', folderId: 'f1', updatedLabel: '更新 10/8' },
  { id: '2', name: '商品3種', category: 'carousel', categoryLabel: 'カルーセル', folderId: 'f2', updatedLabel: '更新 10/7' },
  { id: '3', name: '春の質問', category: 'question', categoryLabel: '質問', updatedLabel: '更新 —' },
]
const folders = [{ id: 'f1', name: '季節' }, { id: 'f2', name: '商品' }]
const categories = [{ id: 'message', label: 'テキスト' }, { id: 'carousel', label: 'カルーセル' }, { id: 'question', label: '質問' }]
const props = { title: 'テンプレートを選ぶ', description: '1つ選びます', confirmLabel: 'このテンプレートを使う', items, folders, categories, preview: <p>見え方</p> }

describe('候補を選ぶ共通の窓', () => {
  it('フォルダ・種類・名前を組み合わせて絞り、選んでも確定するまでは反映しない', async () => {
    const onSelect = vi.fn(), onConfirm = vi.fn()
    render(<SourcePickerDialog {...props} onSelect={onSelect} onConfirm={onConfirm} onCancel={() => {}} />)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(screen.getByRole('navigation', { name: '候補のフォルダ' })).getByRole('button', { name: /季節/ }))
    expect(within(dialog).queryByRole('radio', { name: '商品3種' })).toBeNull()
    fireEvent.click(within(screen.getByLabelText('候補の絞り込み')).getByRole('button', { name: /テキスト/ }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '春' } })
    fireEvent.click(screen.getByRole('radio', { name: '春のお知らせ' }))
    expect(onSelect).toHaveBeenCalledWith('1')
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText('選んだもの：春のお知らせ（テキスト）')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'このテンプレートを使う' }))
    expect(onConfirm).toHaveBeenCalledWith('1')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '存在しない名前' } })
    expect(screen.getByText('当てはまる候補がありません。')).toBeTruthy()
  })

  it('Esc・キャンセルは確定せず、閉じると元のボタンへ焦点を戻す', async () => {
    const confirmed = vi.fn()
    function Host() {
      const [open, setOpen] = React.useState(false)
      return <><button onClick={() => setOpen(true)}>開く</button>{open ? <SourcePickerDialog {...props} onSelect={() => {}} onConfirm={confirmed} onCancel={() => setOpen(false)} /> : null}</>
    }
    render(<Host />)
    const trigger = screen.getByRole('button', { name: '開く' })
    trigger.focus(); fireEvent.click(trigger)
    await screen.findByRole('dialog')
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)) })
    expect(document.activeElement).toBe(screen.getByRole('searchbox'))
    fireEvent.click(screen.getByRole('radio', { name: '春のお知らせ' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(trigger)
    await screen.findByRole('dialog')
    expect((screen.getByRole('radio', { name: '春のお知らせ' }) as HTMLInputElement).checked).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(confirmed).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(trigger)
  })

  it('20件ずつ続きを出す。絞り込みを変えると先頭から出す', async () => {
    const many = Array.from({ length: 45 }, (_, index) => ({ ...items[0], id: String(index), name: `候補${index}` }))
    render(<SourcePickerDialog {...props} items={many} onSelect={() => {}} onConfirm={() => {}} onCancel={() => {}} />)
    await screen.findByRole('dialog')
    expect(screen.getAllByRole('radio')).toHaveLength(20)
    fireEvent.click(screen.getByRole('button', { name: '続きを読み込む' }))
    expect(screen.getAllByRole('radio')).toHaveLength(40)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '候補4' } })
    expect(screen.getAllByRole('radio')).toHaveLength(6)
  })
})
