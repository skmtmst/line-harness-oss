// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import FolderPanel, { FolderPanelNote } from './folder-panel'
import Notice from './notice'

afterEach(cleanup)
const rows = [{ id: '', label: 'すべて', count: 4 }]
it('同じ説明へ寄せ、種類をまたぐ説明と失敗・追加操作を保つ', () => {
  const add = vi.fn()
  const { container } = render(<FolderPanel rows={rows} activeId="" onSelect={() => {}} onAddFolder={add}>
    <FolderPanelNote>フォルダは種類のタブをまたいで使えます。消しても、中のテンプレートは未分類に残ります</FolderPanelNote>
    <Notice tone="danger">分類を読み込めませんでした</Notice>
  </FolderPanel>)
  expect(container.textContent).not.toContain('未分類に残ります')
  expect(screen.getByText('分類を読み込めませんでした')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'フォルダを追加する' }))
  expect(add).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'フォルダの説明' }))
  expect(screen.getByText('フォルダを消しても、中の項目は未分類に残ります。')).toBeTruthy()
  expect(screen.getByText('フォルダは種類のタブをまたいで使えます。')).toBeTruthy()
})
it('固有の説明と閲覧のみの説明を保持し、変更操作を置かない', () => {
  render(<FolderPanel rows={rows} activeId="" onSelect={() => {}} readOnly><FolderPanelNote>フォルダを消しても、アカウントは消えません</FolderPanelNote></FolderPanel>)
  expect(screen.queryByRole('button', { name: 'フォルダを追加する' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'フォルダの説明' }))
  expect(screen.getByText('フォルダを消しても、アカウントは消えません')).toBeTruthy()
})
