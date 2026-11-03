// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import FolderPanel from '@/components/shared/folder-panel'
import Select from '@/components/shared/select'
import { ListPageBody } from './list-page'

afterEach(cleanup)
const rows = [{ id: 'all', label: 'すべて', count: null }, { id: 'spring', label: '春', count: 2 }]

it('畳んだフォルダ選択から追加と切り替えができる', () => {
  const add = vi.fn(), select = vi.fn()
  render(<ListPageBody folders={<FolderPanel rows={rows} activeId="all" onSelect={select} onAddFolder={add} />} folderNav={{ rows, activeId: 'all', onSelect: select }}>本文</ListPageBody>)
  fireEvent.click(screen.getByRole('button', { name: 'フォルダ' }))
  fireEvent.click(within(document.querySelector('[data-select-menu]') as HTMLElement).getByRole('button', { name: 'フォルダを追加する' }))
  expect(add).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'フォルダ' }))
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('button', { name: /春/ }))
  expect(select).toHaveBeenCalledWith('spring')
})

it('画面側で畳んだフォルダ欄を渡す場合も同じ追加操作に届く', () => {
  const add = vi.fn()
  render(<ListPageBody folders={<FolderPanel rows={rows} activeId="all" onSelect={() => {}} onAddFolder={add} />} collapsedFolders={<Select narrowFolderPicker aria-label="フォルダ" value="all" onChange={() => {}} options={[...rows.map(row => ({ value: row.id, label: row.label })), { value: 'manage', label: 'フォルダを管理' }]} />}>本文</ListPageBody>)
  fireEvent.click(screen.getByRole('button', { name: 'フォルダ' }))
  fireEvent.click(within(document.querySelector('[data-select-menu]') as HTMLElement).getByRole('button', { name: 'フォルダを追加する' }))
  expect(add).toHaveBeenCalledOnce()
})

it('フォルダ選択の印がない欄は、名前と候補が一致しても追加操作を出さない', () => {
  const add = vi.fn()
  render(<ListPageBody folders={<FolderPanel rows={rows} activeId="all" onSelect={() => {}} onAddFolder={add} />} collapsedFolders={<Select aria-label="フォルダ" value="all" onChange={() => {}} options={rows.map(row => ({ value: row.id, label: row.label }))} />}>本文</ListPageBody>)
  fireEvent.click(screen.getByRole('button', { name: 'フォルダ' }))
  expect(within(document.querySelector('[data-select-menu]') as HTMLElement).queryByRole('button', { name: 'フォルダを追加する' })).toBeNull()
  expect(add).not.toHaveBeenCalled()
})

it('印がある欄でも候補が一部しか一致しないと追加操作を出さない', () => {
  const add = vi.fn()
  render(<ListPageBody folders={<FolderPanel rows={rows} activeId="all" onSelect={() => {}} onAddFolder={add} />} collapsedFolders={<Select narrowFolderPicker aria-label="フォルダ" value="all" onChange={() => {}} options={[{ value: 'all', label: 'すべて' }, { value: 'other', label: '別の分類' }]} />}>本文</ListPageBody>)
  fireEvent.click(screen.getByRole('button', { name: 'フォルダ' }))
  expect(within(document.querySelector('[data-select-menu]') as HTMLElement).queryByRole('button', { name: 'フォルダを追加する' })).toBeNull()
  expect(add).not.toHaveBeenCalled()
})

it('権限が変わると畳んだ追加操作も消え、以前の処理を呼ばない', () => {
  const add = vi.fn()
  const panel = (allowed: boolean) => <ListPageBody readOnly={!allowed} folders={<FolderPanel rows={rows} activeId="all" onSelect={() => {}} onAddFolder={add} />} folderNav={{ rows, activeId: 'all', onSelect: () => {} }}>本文</ListPageBody>
  const { rerender } = render(panel(true))
  rerender(panel(false))
  fireEvent.click(screen.getByRole('button', { name: 'フォルダ' }))
  expect(within(document.querySelector('[data-select-menu]') as HTMLElement).queryByRole('button', { name: 'フォルダを追加する' })).toBeNull()
  expect(add).not.toHaveBeenCalled()
})

it('異なる2つの分類では一致するフォルダ欄にだけ追加を出す', () => {
  const add = vi.fn(), types = [{ id: 'type-all', label: 'すべて' }, { id: 'type-1', label: '種類A' }]
  render(<ListPageBody folders={<FolderPanel rows={rows} activeId="all" onSelect={() => {}} onAddFolder={add} />} folderNav={[{ rows: types, activeId: 'type-all', label: '種類', onSelect: () => {} }, { rows, activeId: 'all', onSelect: () => {} }]}>本文</ListPageBody>)
  fireEvent.click(screen.getByRole('button', { name: '種類' }))
  expect(within(document.querySelector('[data-select-menu]') as HTMLElement).queryByRole('button', { name: 'フォルダを追加する' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '種類' }))
  fireEvent.click(screen.getByRole('button', { name: 'フォルダ' }))
  fireEvent.click(within(document.querySelector('[data-select-menu]') as HTMLElement).getByRole('button', { name: 'フォルダを追加する' }))
  expect(add).toHaveBeenCalledOnce()
})

it('同じ候補を持つ複数のフォルダ欄を区別できない時は誤った追加操作を出さない', () => {
  const first = vi.fn(), second = vi.fn()
  render(<ListPageBody folders={<><FolderPanel rows={rows} activeId="all" onSelect={() => {}} onAddFolder={first} /><FolderPanel rows={rows} activeId="all" onSelect={() => {}} onAddFolder={second} /></>} folderNav={{ rows, activeId: 'all', onSelect: () => {} }}>本文</ListPageBody>)
  fireEvent.click(screen.getByRole('button', { name: 'フォルダ' }))
  expect(within(document.querySelector('[data-select-menu]') as HTMLElement).queryByRole('button', { name: 'フォルダを追加する' })).toBeNull()
  expect(first).not.toHaveBeenCalled()
  expect(second).not.toHaveBeenCalled()
})

it('フォルダがまだない時も追加でき、閲覧のみでは追加を出さない', () => {
  const add = vi.fn(), one = [rows[0]]
  const { rerender } = render(<ListPageBody folders={<FolderPanel rows={one} activeId="all" onSelect={() => {}} onAddFolder={add} />} folderNav={{ rows: one, activeId: 'all', onSelect: () => {} }}>本文</ListPageBody>)
  fireEvent.click(screen.getByRole('button', { name: 'フォルダ' }))
  fireEvent.click(within(document.querySelector('[data-select-menu]') as HTMLElement).getByRole('button', { name: 'フォルダを追加する' }))
  expect(add).toHaveBeenCalledOnce()
  rerender(<ListPageBody folders={<FolderPanel rows={rows} activeId="all" onSelect={() => {}} readOnly />} folderNav={{ rows, activeId: 'all', onSelect: () => {} }}>本文</ListPageBody>)
  fireEvent.click(screen.getByRole('button', { name: 'フォルダ' }))
  expect(within(document.querySelector('[data-select-menu]') as HTMLElement).queryByRole('button', { name: 'フォルダを追加する' })).toBeNull()
})
