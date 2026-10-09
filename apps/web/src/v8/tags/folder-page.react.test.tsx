// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import FolderPage from './folder-page'

const fx = vi.hoisted(() => ({ push: vi.fn(), params: new URLSearchParams() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: fx.push }), useSearchParams: () => fx.params }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'acc-1' }) }))
vi.mock('./list', () => ({ default: () => <div>友だち属性の一覧</div> }))
vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, tagGroups: { create: vi.fn(), update: vi.fn(), list: vi.fn(), delete: vi.fn() } } }
})
afterEach(() => { cleanup(); vi.clearAllMocks(); fx.params = new URLSearchParams() })

it('タグのフォルダは名前と色を横に並べ、選んだ色を所属アカウントと送る', async () => {
  vi.mocked(api.tagGroups.create).mockResolvedValue({ success: true, data: { id: 'g-new' } } as never)
  await act(async () => { render(<FolderPage />) })
  const input = screen.getByRole('textbox', { name: 'フォルダ名' })
  const colorButton = screen.getByRole('button', { name: 'フォルダの色：緑' })
  expect(input.closest('[data-folder-name-color]')!.contains(colorButton)).toBe(true)
  fireEvent.change(input, { target: { value: ' 購入 ' } })
  fireEvent.click(colorButton)
  fireEvent.click(screen.getByRole('radio', { name: '黄' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'フォルダを作る' })) })
  expect(api.tagGroups.create).toHaveBeenCalledWith({ name: '購入', color: '#fbbf24', accountId: 'acc-1' })
  expect(fx.push).toHaveBeenCalledWith('/tags')
})

it('編集の読み込みが失敗した間は保存・色変更を止め、再読み込み後は保存済みの色を保つ', async () => {
  fx.params = new URLSearchParams('id=g-1')
  vi.mocked(api.tagGroups.list).mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ success: true, data: [{ id: 'g-1', name: '旧名', color: '#123456', accountId: 'acc-1' }] } as never)
  vi.mocked(api.tagGroups.update).mockResolvedValue({ success: true, data: { id: 'g-1' } } as never)
  await act(async () => { render(<FolderPage />) })
  expect((screen.getByRole('button', { name: 'フォルダを保存する' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'フォルダの色：緑' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' })) })
  fireEvent.change(screen.getByRole('textbox', { name: 'フォルダ名' }), { target: { value: '新名' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'フォルダを保存する' })) })
  expect(api.tagGroups.update).toHaveBeenCalledWith('g-1', { name: '新名', color: '#123456', accountId: 'acc-1' })
})

it('フォルダ名の未入力は欄で知らせ、そこに戻して作成しない', async () => {
 const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined)
 render(<FolderPage />)
 fireEvent.click(screen.getByRole('button', { name: 'フォルダを作る' }))
 const input = screen.getByRole('textbox', { name: 'フォルダ名' })
 expect(input.getAttribute('aria-invalid')).toBe('true')
 expect(document.activeElement).toBe(input)
 expect(screen.getAllByText('フォルダ名を入力してください')).toHaveLength(1)
 expect(api.tagGroups.create).not.toHaveBeenCalled()
 expect(scroll).toHaveBeenCalledWith({ block: 'center' })
 scroll.mockRestore()
})
