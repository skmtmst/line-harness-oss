// @vitest-environment happy-dom
/*
 * 統括のアカウント（/hq・src/v8/hq/home.tsx）の配線を、描いて押して確かめる。
 * - 登録の口は一般の登録（/accounts/new）へ。閲覧のみには置かない
 * - 読み込みの失敗は共通の案内。403 は押しても直らないので「もう一度読み込む」を出さない
 * - 「更新する」は全アカウントの接続を確かめ直し、版を添えて送り、一覧を読み直す
 * - 「設定」→「LINE の登録内容を編集」で既存の編集の窓。保存のあとは一覧を読み直す
 * - 「入る」は選んだアカウントを覚え、店舗未選択から来たときは元の画面へ戻す
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import { loadFailureNotice } from '@/components/shared/api-error-message'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const mocks = vi.hoisted(() => ({
  list: vi.fn(), fetchApi: vi.fn(), select: vi.fn(), refresh: vi.fn(), push: vi.fn(), folders: vi.fn(),
  role: 'owner', editProps: null as null | Record<string, unknown>,
}))

vi.mock('next/navigation', async () => ({
  ...(await import('@/test-utils/navigation-mock')).navigationMock(),
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement('a', { href }, children) }))
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('@/components/hq/platform-notices', () => ({ default: () => null }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ setSelectedAccountId: mocks.select, refreshAccounts: mocks.refresh }) }))
vi.mock('@/lib/staff-role', async (original) => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => mocks.role }))
/* 設定の窓と編集の窓の中身は、それぞれの試験が見る。ここでは画面からの受け渡しだけを見る。 */
vi.mock('@/v8/hq/account-dialogs', async (original) => ({
  ...await original<typeof import('@/v8/hq/account-dialogs')>(),
  AccountSettingsDialogV8: ({ account, onEditRegistration, onSaved }: { account: { name: string }; onEditRegistration: () => void; onSaved: () => void }) => (
    <div role="dialog" aria-label={`${account.name}の設定`}>
      <button type="button" onClick={onEditRegistration}>LINE の登録内容を編集</button>
      <button type="button" onClick={onSaved}>保存する</button>
    </div>
  ),
  AccountArchiveDialogV8: () => null,
  AccountRestoreDialogV8: () => null,
}))
vi.mock('@/components/accounts/account-edit-modal', () => ({
  default: (props: Record<string, unknown> & { onSaved: () => void }) => {
    mocks.editProps = props
    return <div role="dialog" aria-label="アカウントの編集"><button type="button" onClick={props.onSaved}>編集を保存</button></div>
  },
}))
vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  return {
    ...actual,
    fetchApi: mocks.fetchApi,
    api: {
      ...actual.api,
      lineAccounts: { ...actual.api.lineAccounts, list: mocks.list, stepFollowerImport: vi.fn(async () => ({ success: true, data: {} })) },
      lineAccountFolders: { ...actual.api.lineAccountFolders, list: mocks.folders },
      tenants: { ...actual.api.tenants, me: vi.fn(async () => ({ success: true, data: { name: '統括' } })) },
    },
  }
})

import HqHomeV8 from '@/v8/hq/home'

const account = (id: string, name: string, revision: number | null = 1) => ({
  id, revision, name, displayName: name, channelId: `ch-${id}`, basicId: `@${id}`, isActive: true, country: null, role: null,
  displayOrder: 0, archivedAt: null, tags: [], folderId: null,
  stats: { friendCount: 1, messagesThisMonth: 0, activeScenarios: 0, staffCount: 1 },
  connection: { status: 'warn', checkedAt: null, tokenExpired: false, issues: [] },
})

beforeEach(() => {
  vi.clearAllMocks()
  window.history.replaceState(null, '', '/hq')
  mocks.role = 'owner'
  mocks.editProps = null
  mocks.list.mockResolvedValue({ success: true, data: [account('a1', '銀座店')] })
  mocks.folders.mockResolvedValue({ success: true, data: { folders: [], total: 0, unclassifiedCount: 0 } })
  mocks.refresh.mockResolvedValue(undefined)
  mocks.fetchApi.mockResolvedValue({ success: true, data: {} })
})
afterEach(() => { cleanup(); window.history.replaceState(null, '', '/') })

const links = (name: string) => screen.queryAllByRole('link', { name }).map((link) => link.getAttribute('href'))

describe('統括のアカウント：登録の口', () => {
  it('オーナーには一般のアカウント登録へ進む口を置き、飲食の店舗作成へは送らない', async () => {
    render(<HqHomeV8 />)
    await screen.findAllByText('銀座店')
    expect(links('アカウントを登録').length).toBeGreaterThan(0)
    expect(new Set(links('アカウントを登録'))).toEqual(new Set(['/accounts/new']))
    expect(document.querySelector('a[href*="restaurant-test/stores/new"]')).toBeNull()
  })

  it('閲覧のみには登録の口を置かない', async () => {
    mocks.role = 'viewer'
    render(<HqHomeV8 />)
    await screen.findAllByText('銀座店')
    expect(links('アカウントを登録')).toEqual([])
  })

  it('0件のときは最初の登録へ案内する', async () => {
    mocks.list.mockResolvedValue({ success: true, data: [] })
    render(<HqHomeV8 />)
    await screen.findByText('まだ LINE 公式アカウントがありません')
    expect(links('最初のアカウントを登録する')).toEqual(['/accounts/new'])
  })
})

describe('統括のアカウント：読み込みの失敗（M021）', () => {
  it('通信の失敗は共通の案内を出し、「もう一度読み込む」で読み直して一覧に戻る', async () => {
    const failure = new ApiError(503, 'API error: 503')
    mocks.list.mockRejectedValueOnce(failure)
    render(<HqHomeV8 />)
    const retry = await screen.findByRole('button', { name: 'もう一度読み込む' })
    expect(screen.getByText(loadFailureNotice(failure, '統括のアカウント情報', 'hq'))).toBeTruthy()
    expect(document.body.textContent).not.toContain('API error')
    expect(document.body.textContent).not.toContain('統括のアカウント情報を読み込めませんでした。')
    await act(async () => { fireEvent.click(retry) })
    await screen.findAllByText('銀座店')
    expect(mocks.list).toHaveBeenCalledTimes(2)
  })

  it('403 は権限の案内にし、押しても直らないので「もう一度読み込む」を出さない', async () => {
    const failure = new ApiError(403, 'API error: 403')
    mocks.list.mockRejectedValueOnce(failure)
    render(<HqHomeV8 />)
    await screen.findByText(loadFailureNotice(failure, '統括のアカウント情報', 'hq'))
    expect(document.body.textContent).toContain('統括のアカウント情報を見る権限がありません')
    expect(screen.queryByRole('button', { name: 'もう一度読み込む' })).toBeNull()
  })
})

describe('統括のアカウント：接続の確かめ直し', () => {
  it('「更新する」で全アカウントへ版と重複よけの鍵を添えて送り、一覧と店の一覧を読み直す', async () => {
    mocks.list.mockResolvedValue({ success: true, data: [account('a1', '銀座店', 3), account('a/2', '梅田店', 7)] })
    render(<HqHomeV8 />)
    await screen.findAllByText('銀座店')
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: '更新する' })[0]) })
    await screen.findByText('2 件のLINE IDと接続状態を更新しました。')
    expect(mocks.fetchApi).toHaveBeenCalledTimes(2)
    const [firstPath, firstInit] = mocks.fetchApi.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect(firstPath).toBe('/api/line-accounts/a1/connection-checks')
    expect(firstInit.method).toBe('POST')
    expect(JSON.parse(String(firstInit.body))).toEqual({ expectedRevision: 3 })
    expect(firstInit.headers['Idempotency-Key']).toMatch(/^hq-check-a1-/)
    const [secondPath, secondInit] = mocks.fetchApi.mock.calls[1] as [string, RequestInit & { headers: Record<string, string> }]
    expect(secondPath).toBe('/api/line-accounts/a%2F2/connection-checks')
    expect(JSON.parse(String(secondInit.body))).toEqual({ expectedRevision: 7 })
    expect(secondInit.headers['Idempotency-Key']).not.toBe(firstInit.headers['Idempotency-Key'])
    expect(mocks.list).toHaveBeenCalledTimes(2)
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })

  it('版の無いアカウントは送らずに「更新できなかった」に数える', async () => {
    mocks.list.mockResolvedValue({ success: true, data: [account('a1', '銀座店', 3), account('a2', '梅田店', null)] })
    render(<HqHomeV8 />)
    await screen.findAllByText('銀座店')
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: '更新する' })[0]) })
    await screen.findByText('1 件を更新し、1 件は更新できませんでした。')
    expect(mocks.fetchApi).toHaveBeenCalledTimes(1)
  })

  it('確かめている間にもう一度押しても重ねて送らない', async () => {
    let finish: (value: unknown) => void = () => {}
    mocks.fetchApi.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    render(<HqHomeV8 />)
    await screen.findAllByText('銀座店')
    const button = screen.getAllByRole('button', { name: '更新する' })[0]
    await act(async () => { fireEvent.click(button) })
    await act(async () => { fireEvent.click(button) })
    expect(mocks.fetchApi).toHaveBeenCalledTimes(1)
    await act(async () => { finish({ success: true, data: {} }) })
    await screen.findByText('1 件のLINE IDと接続状態を更新しました。')
    expect(mocks.fetchApi).toHaveBeenCalledTimes(1)
  })
})

describe('統括のアカウント：設定と編集', () => {
  it('「設定」→「LINE の登録内容を編集」で既存の編集の窓にそのアカウントを渡し、保存のあと一覧を読み直す', async () => {
    render(<HqHomeV8 />)
    await screen.findAllByText('銀座店')
    fireEvent.click(screen.getByRole('button', { name: '銀座店 の設定' }))
    fireEvent.click(screen.getByRole('button', { name: 'LINE の登録内容を編集' }))
    expect(screen.getByRole('dialog', { name: 'アカウントの編集' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: '銀座店の設定' })).toBeNull()
    expect(mocks.editProps).toMatchObject({ accountId: 'a1', initialName: '銀座店', initialChannelId: 'ch-a1' })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '編集を保存' })) })
    expect(mocks.list).toHaveBeenCalledTimes(2)
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })

  it('設定の窓で保存すると窓を閉じて一覧を読み直す', async () => {
    render(<HqHomeV8 />)
    await screen.findAllByText('銀座店')
    fireEvent.click(screen.getByRole('button', { name: '銀座店 の設定' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存する' })) })
    expect(screen.queryByRole('dialog', { name: '銀座店の設定' })).toBeNull()
    expect(mocks.list).toHaveBeenCalledTimes(2)
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })
})

describe('統括のアカウント：入る', () => {
  it('入ると選んだアカウントを覚え、識別子を住所に付けずに店のホームへ移る', async () => {
    render(<HqHomeV8 />)
    await screen.findAllByText('銀座店')
    fireEvent.click(screen.getByRole('button', { name: '銀座店 へ入る' }))
    expect(mocks.select).toHaveBeenCalledWith('a1')
    expect(mocks.push).toHaveBeenCalledTimes(1)
    expect(mocks.push.mock.calls[0][0]).toBe('/')
  })

  it('店舗未選択から来たときは元の画面へ戻し、外の住所や統括の画面へは戻さない', async () => {
    window.history.replaceState(null, '', '/hq?return=%2Ffriends%3Ftab%3Dall')
    render(<HqHomeV8 />)
    await screen.findAllByText('銀座店')
    fireEvent.click(screen.getByRole('button', { name: '銀座店 へ入る' }))
    expect(mocks.push.mock.calls[0][0]).toBe('/friends?tab=all')
    for (const back of ['https%3A%2F%2Fevil.example%2F', '%2Fhq%2Fmembers']) {
      cleanup()
      mocks.push.mockClear()
      window.history.replaceState(null, '', `/hq?return=${back}`)
      render(<HqHomeV8 />)
      await screen.findAllByText('銀座店')
      fireEvent.click(screen.getByRole('button', { name: '銀座店 へ入る' }))
      // 外の住所と、店を選ばなくても開ける統括の画面へは戻さず、店のホームへ移る。
      expect(mocks.push.mock.calls[0][0]).toBe('/')
    }
  })
})
