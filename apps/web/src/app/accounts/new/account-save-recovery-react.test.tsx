// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import NewLineAccountPage from './page'

/**
 * R523: LINEアカウント登録の保存応答を失うと未保存と誤案内し、再試行で重複する。
 * - 応答のない保存失敗は「DBには保存していません」と断定せず、同じチャネルIDの
 *   登録済みを照合して詳細への復帰を出す。
 * - 重複エラー（同じ情報での再試行）は行き止まりにせず、登録済みの詳細へ案内する。
 * - 行が無い真の失敗は従来どおり失敗として出す。
 */
const calls = vi.hoisted(() => ({
  connectCheck: vi.fn(), connect: vi.fn(), stepFollowerImport: vi.fn(), list: vi.fn(),
}))
const notices = vi.hoisted(() => ({ lineRegistration: vi.fn() }))
vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return { ...actual, api: { lineAccounts: calls, hqNotices: notices } }
})
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,QR' } }))
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
  calls.list.mockResolvedValue({ success: true, data: [] })
  notices.lineRegistration.mockResolvedValue({ success: true, data: { available: false } })
})

const fill = (id: string, value: string) => fireEvent.change(document.getElementById(id)!, { target: { value } })
const next = () => fireEvent.click(screen.getByRole('button', { name: '次へ' }))

async function enterSaveStep() {
  render(<NewLineAccountPage />)
  next()
  next()
  fill('channel-id', '123456789')
  fill('channel-secret', 'synthetic-secret')
  fill('login-channel-id', '2007123456')
  fill('login-channel-secret', 'synthetic-login-secret')
  next()
  fireEvent.click(screen.getByRole('button', { name: '接続して設定する' }))
  await screen.findByText('5段すべて通りました。保存できます。')
}

async function save() {
  fireEvent.click(screen.getByRole('button', { name: '接続して保存する' }))
}

describe('R523 保存の応答消失と重複（本物のReact）', () => {
  it('応答を失っても未保存と断定せず、登録済みの詳細へ復帰する', async () => {
    await enterSaveStep()
    // サーバ側では行が作られたが、応答だけ届かない。
    calls.connect.mockRejectedValue(new Error('fetch failed'))
    calls.list.mockResolvedValue({
      success: true,
      data: [{ id: 'acc-9', channelId: '123456789', name: '登録済み' }],
    })
    await save()

    await screen.findByText('保存は終わっている可能性があります。登録済みのアカウントを開いて確認してください。')
    expect(screen.queryByText(/DBには保存していません/)).toBeNull()
    const back = screen.getByRole('link', { name: '登録したアカウントを見る' })
    expect(back.getAttribute('href')).toBe('/accounts/detail?id=acc-9')
    // 重複作成はしない（保存口は1回だけ）。
    expect(calls.connect).toHaveBeenCalledTimes(1)
  })

  it('同じ情報での再試行の重複エラーは行き止まりにせず詳細へ案内する', async () => {
    await enterSaveStep()
    calls.connect.mockResolvedValue({ success: false, error: 'channelId already registered' })
    calls.list.mockResolvedValue({
      success: true,
      data: [{ id: 'acc-9', channelId: '123456789', name: '登録済み' }],
    })
    await save()

    await screen.findByText('このチャネルIDは登録済みです。登録済みのアカウントを開いて確認してください。')
    expect(screen.getByRole('link', { name: '登録したアカウントを見る' }).getAttribute('href')).toBe('/accounts/detail?id=acc-9')
  })

  it('行が無い真の失敗は失敗として出す', async () => {
    await enterSaveStep()
    calls.connect.mockRejectedValue(new Error('fetch failed'))
    calls.list.mockResolvedValue({ success: true, data: [] })
    await save()

    await screen.findByText('登録できませんでした。時間をおいて、もう一度お試しください。')
    expect(screen.queryByText(/DBには保存していません/)).toBeNull()
  })
})
