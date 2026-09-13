// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import NewLineAccountPage from './page'

const calls = vi.hoisted(() => ({
  connectCheck: vi.fn(), connect: vi.fn(), stepFollowerImport: vi.fn(),
}))
vi.mock('@/lib/api', () => ({ api: { lineAccounts: calls } }))
vi.mock('next/navigation', () => ({ usePathname: () => '/accounts/new', useRouter: () => ({ push: vi.fn() }) }))

const passedSteps = [
  'チャネルIDとシークレットでアクセストークンを発行',
  '公式アカウントの名前とアイコンを取得',
  'Webhook URLを登録して、実際に届くかテスト',
  'LINE Loginチャネルを確認して、LIFFアプリを作成',
  '認証済みアカウントかを判定',
].map((message, index) => ({ order: index + 1, state: 'passed', message }))

const checked = {
  success: true,
  data: {
    steps: passedSteps,
    displayName: 'LINE公式名',
    pictureUrl: null,
    basicId: '@line',
    liffId: '2007123456-auto',
    followerImport: { capability: 'unavailable', phase: 'not_started' },
    remainingActions: [],
  },
}

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  calls.connectCheck.mockResolvedValue(checked)
  calls.connect.mockResolvedValue({ success: true, data: { ...checked.data, id: 'new-account' } })
})

const fill = (id: string, value: string) => fireEvent.change(document.getElementById(id)!, { target: { value } })
const next = () => fireEvent.click(screen.getByRole('button', { name: '次へ' }))

async function enterConnectionStep() {
  render(<NewLineAccountPage />)
  next()
  next()
  fill('channel-id', '123456789')
  fill('channel-secret', 'synthetic-secret')
  fill('login-channel-id', '2007123456')
  fill('login-channel-secret', 'synthetic-login-secret')
  next()
  expect(screen.getByText('4. LINE側の設定')).toBeTruthy()
}

async function checkConnection() {
  fireEvent.click(screen.getByRole('button', { name: '接続して設定する' }))
  await screen.findByText('5段すべて通りました。保存できます。')
}

describe('LINEアカウント作成ウィザード', () => {
  it('手順1は表示名だけで、未入力のまま次へ進める', () => {
    render(<NewLineAccountPage />)
    expect(document.getElementById('account-name')).toBeTruthy()
    expect(document.querySelectorAll('input')).toHaveLength(1)
    next()
    expect(screen.getByText('2. LINE側の準備')).toBeTruthy()
  })

  it('新規を選んだときだけ公式アカウント作成リンクを出す', () => {
    render(<NewLineAccountPage />)
    next()
    expect(screen.queryByRole('link', { name: /LINE公式アカウントを作る/ })).toBeNull()
    fireEvent.click(screen.getByLabelText('新しく公式アカウントを作成'))
    const link = screen.getByRole('link', { name: /LINE公式アカウントを作る/ })
    expect(link.getAttribute('href')).toBe('https://manager.line.biz/')
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('手順3は4項目だけを必須にし、マニュアルを別タブで開く', () => {
    render(<NewLineAccountPage />)
    next()
    next()
    const ids = ['channel-id', 'channel-secret', 'login-channel-id', 'login-channel-secret']
    expect(ids.every((id) => (document.getElementById(id) as HTMLInputElement).required)).toBe(true)
    expect(document.getElementById('channel-access-token')).toBeNull()
    expect(document.getElementById('liff-id')).toBeNull()
    expect(screen.getAllByRole('link', { name: '取得方法を見る' }).map((node) => node.getAttribute('href')))
      .toEqual(['/manuals/line-connect/index.html#m1', '/manuals/line-connect/index.html#m2'])
  })

  it('5段で止まった箇所を示し、失敗時は保存できない', async () => {
    calls.connectCheck.mockResolvedValue({
      success: true,
      data: {
        ...checked.data,
        steps: passedSteps.map((item, index) => index === 2
          ? { ...item, state: 'failed', message: 'Webhookの利用をオンにしてください' }
          : index > 2 ? { ...item, state: 'skipped' } : item),
      },
    })
    await enterConnectionStep()
    fireEvent.click(screen.getByRole('button', { name: '接続して設定する' }))
    expect(await screen.findAllByText('Webhookの利用をオンにしてください')).toHaveLength(2)
    expect((screen.getByRole('button', { name: '接続して保存' }) as HTMLButtonElement).disabled).toBe(true)
    expect(calls.connect).not.toHaveBeenCalled()
  })

  it('未認証アカウントは保存直後から完了ボタンを使える', async () => {
    await enterConnectionStep()
    await checkConnection()
    fireEvent.click(screen.getByRole('button', { name: '接続して保存' }))
    await screen.findByText('登録が完了しました', { selector: 'h2' })
    expect(calls.connect).toHaveBeenCalledWith({
      name: undefined,
      channelId: '123456789',
      channelSecret: 'synthetic-secret',
      loginChannelId: '2007123456',
      loginChannelSecret: 'synthetic-login-secret',
    })
    expect(screen.getByRole('link', { name: '登録したアカウントを見る' }).getAttribute('href')).toBe('/accounts/detail?id=new-account')
    expect(screen.getByRole('link', { name: '統括コンソールへ' }).getAttribute('href')).toBe('/hq')
    expect(document.body.textContent).not.toContain('synthetic-secret')
  })

  it('認証済みはID取り込み中のボタンを止め、hydrating_profilesで有効にする', async () => {
    let finishStep!: (value: unknown) => void
    calls.connect.mockResolvedValue({
      success: true,
      data: {
        ...checked.data,
        id: 'verified-account',
        followerImport: { capability: 'available', phase: 'importing_ids' },
      },
    })
    calls.stepFollowerImport.mockImplementation(() => new Promise((resolve) => { finishStep = resolve }))
    await enterConnectionStep()
    await checkConnection()
    fireEvent.click(screen.getByRole('button', { name: '接続して保存' }))
    expect(await screen.findAllByText(/既存の友だちを取り込んでいます/)).toHaveLength(2)
    expect((screen.getByRole('button', { name: '登録したアカウントを見る' }) as HTMLButtonElement).disabled).toBe(true)
    finishStep({ success: true, data: { state: {
      capability: 'available', phase: 'hydrating_profiles', received: 10, imported: 10,
    }, busy: false } })
    await waitFor(() => expect(screen.getByRole('link', { name: '登録したアカウントを見る' })).toBeTruthy())
  })
})
