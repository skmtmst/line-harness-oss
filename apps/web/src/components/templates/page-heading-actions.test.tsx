// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Button from '@/components/shared/button'
import { PageHeading } from './page-frame'
import { CreatePage } from './create-page'
import { RowMenu } from '@/components/shared/row-actions'
import { useState } from 'react'

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

it('属性付きの包みの非表示・操作・読み上げを保つ', () => {
  const click = vi.fn()
  render(<PageHeading title="テスト" actions={<><span hidden><Button variant="primary">秘密の操作</Button></span><div role="group" aria-label="まとめ" onClick={click}><Button>読む</Button></div></>} />)
  expect(screen.queryByRole('button', { name: '秘密の操作' })).toBeNull()
  expect(screen.getByRole('group', { name: 'まとめ' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '読む' }))
  expect(click).toHaveBeenCalledOnce()
})

it('メニューへ移した非同期保存の二重実行を防ぎ、失敗を表示して再試行できる', async () => {
  let fail!: (reason: Error) => void
  const save = vi.fn(() => new Promise<void>((_, reject) => { fail = reject }))
  render(<CreatePage title="作る" dirty={false} footerActions={<><Button>キャンセル</Button><Button onClick={save}>下書きを保存</Button><Button variant="primary">保存する</Button></>}>本文</CreatePage>)
  fireEvent.click(screen.getByRole('button', { name: '作成・編集のその他の操作' }))
  const item = await screen.findByRole('menuitem', { name: '下書きを保存' })
  fireEvent.click(item); fireEvent.click(item)
  expect(save).toHaveBeenCalledOnce()
  expect(screen.getByRole('menu')).toBeTruthy()
  await act(async () => { fail(new Error('保存に失敗')) })
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: '下書きを保存' })).toBeTruthy()
  fireEvent.click(screen.getByRole('menuitem', { name: '下書きを保存' }))
  expect(save).toHaveBeenCalledTimes(2)
  await act(async () => { fail(new Error('保存に失敗')) })
})

it('既存のメニューの開閉制御とラベル、危険な操作の色を保つ', async () => {
  const change = vi.fn()
  function Fixture() {
    const [open, setOpen] = useState(false)
    return <PageHeading title="テスト" actions={<><Button>読む</Button><Button variant="primary">作る</Button><Button variant="danger">削除する</Button><RowMenu label="固有の操作" open={open} onOpenChange={value => { change(value); setOpen(value) }} items={[{ id: 'existing', label: '履歴を見る', onSelect() {} }]} /></>} />
  }
  render(<Fixture />)
  fireEvent.click(screen.getByRole('button', { name: '固有の操作' }))
  expect(change).toHaveBeenCalledWith(true)
  expect(await screen.findByRole('menuitem', { name: '履歴を見る' })).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: '削除する' }).className).toContain('textDanger')
})

it('非表示の主操作を数えず、非同期成功後は自分のメニューへ焦点を戻す', async () => {
  let finish!: () => void
  const save = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const { container } = render(<PageHeading title="テスト" actions={<><Button variant="primary" hidden>隠れた作成</Button><Button variant="primary">作る</Button><Button>読む</Button><Button onClick={save}>下書きを保存</Button><Button hidden>隠れた補助</Button></>} />)
  expect(screen.getByRole('button', { name: '作る' })).toBeTruthy()
  const trigger = screen.getByRole('button', { name: 'その他の操作' })
  fireEvent.click(trigger)
  fireEvent.click(await screen.findByRole('menuitem', { name: '下書きを保存' }))
  expect(screen.queryByRole('menuitem', { name: '隠れた補助' })).toBeNull()
  await act(async () => { finish() })
  await waitFor(() => expect(container.querySelector('[aria-expanded="true"]')).toBeNull())
  expect(document.activeElement).toBe(trigger)
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
