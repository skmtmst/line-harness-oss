// @vitest-environment happy-dom
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ListToolbar, { ListToolbarFrame, ListToolbarRow, ListToolbarSearchSlot, ListToolbarEnd } from './list-toolbar'

afterEach(cleanup)

describe('B-178 共通の道具の段の操作', () => {
  it('検索の変更と消す操作を元の受け口へ返す', async () => {
    const onChange = vi.fn()
    render(<ListToolbar search={{ placeholder: '名前を探す', label: '一覧を検索', value: '来店', onChange }} />)
    fireEvent.change(screen.getByRole('searchbox', { name: '一覧を検索' }), { target: { value: '予約' } })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('予約'))
    fireEvent.click(screen.getByRole('button', { name: /消/ }))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('読み上げ名が省略されたときは探す欄の説明を使う', () => {
    render(<ListToolbar search={{ placeholder: '名前・本文を探す', value: '', onChange: vi.fn() }} />)
    expect(screen.getByRole('searchbox', { name: '名前・本文を探す' })).toBeTruthy()
  })

  it('検索がない一覧でも絞り込みと件数を操作できる', () => {
    const filter = vi.fn(), size = vi.fn()
    render(<ListToolbar filters={<button onClick={filter}>予約のみ</button>} trailing={<select aria-label="表示件数" onChange={size}><option>20件</option><option>50件</option></select>} />)
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '予約のみ' }))
    fireEvent.change(screen.getByRole('combobox', { name: '表示件数' }), { target: { value: '50件' } })
    expect(filter).toHaveBeenCalledOnce()
    expect(size).toHaveBeenCalledOnce()
  })

  it('フォームを共通の段へ移しても検索の送信と条件操作を保つ', () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault()), filter = vi.fn()
    render(<ListToolbarFrame><ListToolbarRow as="form" onSubmit={submit}>
      <ListToolbarSearchSlot><input aria-label="検索" defaultValue="来店" /></ListToolbarSearchSlot>
      <button type="submit">検索する</button>
      <ListToolbarEnd><button type="button" onClick={filter}>詳細条件</button></ListToolbarEnd>
    </ListToolbarRow></ListToolbarFrame>)
    fireEvent.submit(screen.getByRole('textbox', { name: '検索' }).closest('form')!)
    fireEvent.click(screen.getByRole('button', { name: '詳細条件' }))
    expect(submit).toHaveBeenCalledOnce()
    expect(filter).toHaveBeenCalledOnce()
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: '検索' }).value).toBe('来店')
  })

  it('2段目の状態切り替えも操作を保つ', () => {
    const onClick = vi.fn()
    render(<ListToolbar secondary={<button onClick={onClick}>注目のみ</button>} />)
    fireEvent.click(screen.getByRole('button', { name: '注目のみ' }))
    expect(onClick).toHaveBeenCalledOnce()
  })
})

it('並びは道具の段の共通欄だけで選ぶ', () => {
  const html = renderToStaticMarkup(<ListToolbar search={{ placeholder: '探す', value: '', onChange: vi.fn() }} sort={{ value: 'recent', onChange: vi.fn(), options: [{ value: 'recent', label: '新しい順' }] }} />)
  expect(html).toContain('data-list-sort')
  expect(html).toContain('aria-label="並び"')
})
