// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import NewLineAccountPage from './page'

const calls = vi.hoisted(() => ({ list: vi.fn(), verify: vi.fn(), create: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { lineAccounts: {
  list: calls.list, verifyConnection: calls.verify, create: calls.create,
} } }))
vi.mock('next/navigation', () => ({ usePathname: () => '/accounts/new', useRouter: () => ({ push: vi.fn() }) }))
const passed = { success: true, data: { messagingApi: true, webhook: true, lineLogin: true, liff: true, errors: [] } }
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  calls.list.mockResolvedValue({ success: true, data: [] })
  calls.verify.mockResolvedValue(passed)
  calls.create.mockResolvedValue({ success: true, data: { id: 'new-account' } })
})
const fill = (id: string, value: string) => fireEvent.change(document.getElementById(id)!, { target: { value } })
const next = () => fireEvent.click(screen.getByRole('button', { name: '次へ' }))
async function enterConnectionStep() {
  render(<NewLineAccountPage />)
  await waitFor(() => expect(calls.list).toHaveBeenCalledOnce())
  fill('account-name', '試験用アカウント')
  next()
  fill('channel-id', '123456')
  fill('channel-secret', 'synthetic-secret')
  fill('channel-access-token', 'synthetic-token')
  next()
  fill('login-channel-id', '789012')
  fill('login-channel-secret', 'synthetic-login-secret')
  fill('liff-id', '789012-example')
  next()
}
async function confirmConnection() {
  fireEvent.click(screen.getByRole('button', { name: '接続を確かめる' }))
  await waitFor(() => expect(screen.getByText('すべての接続を確認できました。次へ進めます。')).toBeTruthy())
  next()
}

describe('アカウント作成ウィザード', () => {
  it('未入力を止め、戻っても入力を保持する', async () => {
    render(<NewLineAccountPage />)
    next()
    expect(screen.getByText('表示名を入力してください。')).toBeTruthy()
    fill('account-name', '保持する名前')
    next()
    fireEvent.click(screen.getByRole('button', { name: '戻る' }))
    expect((document.getElementById('account-name') as HTMLInputElement).value).toBe('保持する名前')
    expect(calls.create).not.toHaveBeenCalled()
    expect(document.querySelector('select')).toBeNull()
    expect(screen.getByRole('button', { name: 'タイムゾーン' })).toBeTruthy()
  })

  it('接続失敗時は保存せず最終確認へ進めない', async () => {
    calls.verify.mockResolvedValue({ success: false, error: 'private provider error' })
    await enterConnectionStep()
    fireEvent.click(screen.getByRole('button', { name: '接続を確かめる' }))
    await screen.findByText('接続を確認できませんでした。入力内容とLINE Developersの設定を確認してください。')
    next()
    expect(screen.getByText('接続確認がすべて通ってから次へ進んでください。')).toBeTruthy()
    expect(calls.create).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('private provider error')
  })

  it('保存直前の再確認に失敗したらcreateを呼ばない', async () => {
    await enterConnectionStep()
    await confirmConnection()
    calls.verify.mockResolvedValue({ success: true, data: { ...passed.data, webhook: false } })
    fireEvent.click(screen.getByRole('button', { name: '接続を確かめて保存' }))
    await screen.findByText('接続確認で止まったため、保存していません。前の手順に戻って設定を確認してください。')
    expect(calls.create).not.toHaveBeenCalled()
  })

  it('保存中の再送を止め、確認画面に秘密値を出さず成功後に詳細リンクを出す', async () => {
    let complete!: (value: unknown) => void
    calls.create.mockImplementation(() => new Promise(resolve => { complete = resolve }))
    await enterConnectionStep()
    await confirmConnection()
    expect(document.body.textContent).not.toContain('synthetic-secret')
    expect(document.body.textContent).not.toContain('synthetic-token')
    fireEvent.click(screen.getByRole('button', { name: '接続を確かめて保存' }))
    await waitFor(() => expect(calls.create).toHaveBeenCalledOnce())
    fireEvent.submit(document.querySelector('form')!)
    expect(calls.create).toHaveBeenCalledOnce()
    expect((screen.getByRole('button', { name: 'やめる' }) as HTMLButtonElement).disabled).toBe(true)
    expect(calls.create.mock.calls[0][0]).toMatchObject({ name: '試験用アカウント', country: '日本', role: null, parentLineAccountId: null })
    complete({ success: true, data: { id: 'new-account' } })
    await screen.findByText('登録が完了しました', { selector: 'h2' })
    expect(screen.getByRole('link', { name: '登録したアカウントを見る' }).getAttribute('href')).toBe('/accounts/detail?id=new-account')
    expect(document.querySelector('input[type="password"]')).toBeNull()
  })
})
