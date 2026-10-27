// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Button from '@/components/shared/button'
import { PageHeading } from './page-frame'
import { CreatePage } from './create-page'

afterEach(cleanup)

it('題の右に主操作と文字の副操作を1つ置き、残りの操作をメニューから実行する', async () => {
  const extra = vi.fn()
  const { container } = render(<PageHeading title="テスト" actions={<>
    <Button>CSVで書き出す</Button>
    <Button variant="primary">作る</Button>
    <Button onClick={extra}>複製する</Button>
  </>} />)
  expect(screen.getByRole('button', { name: 'CSVで書き出す' }).getAttribute('data-variant')).toBe('text')
  expect(screen.getByRole('button', { name: '作る' }).getAttribute('data-variant')).toBe('primary')
  expect(screen.queryByRole('button', { name: '複製する' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'その他の操作' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: '複製する' }))
  expect(extra).toHaveBeenCalledOnce()
  await waitFor(() => expect(container.querySelector('[data-page-heading-actions] [aria-expanded="true"]')).toBeNull())
})

it('作成の保存帯は取消と保存を保ち、下書き操作と無効条件を題のメニューへ渡す', async () => {
  const draft = vi.fn(), save = vi.fn(), cancel = vi.fn()
  const { container } = render(<CreatePage title="作る" footerActions={<>
    <Button onClick={cancel}>キャンセル</Button><Button onClick={draft} disabled>下書きを保存</Button><Button variant="primary" onClick={save}>保存する</Button>
  </>}><label>名前<input /></label></CreatePage>)
  expect(container.querySelector('[data-sticky-actions]')?.textContent).toBe('キャンセル保存する')
  fireEvent.click(screen.getByRole('button', { name: '作成・編集のその他の操作' }))
  const item = await screen.findByRole('menuitem', { name: '下書きを保存' })
  expect((item as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(item)
  expect(draft).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '保存する' }))
  expect(save).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
  expect(cancel).toHaveBeenCalledOnce()
})
