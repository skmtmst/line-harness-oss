// @vitest-environment happy-dom
/*
 * 運用状態の外側（板 Y4LkX1・I2V65v・OHwbU）を描いて見る。
 *
 * - タブは板の並び（健全性チェック・更新履歴・緊急コントロール）。オーナーには見張りのタブが続く。
 * - 題は板の頭の1つだけで、h1 を重ねない。説明は「？」から開く。
 * - アカウント一覧の取得に失敗したら黙らせず、読み直せる。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import EmergencyScreen from './screen'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const state = vi.hoisted(() => ({
  tab: 'health',
  accountCalls: 0,
  accounts: [] as Array<() => Promise<unknown>>,
}))

vi.mock('@/contexts/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('@/components/layout/settings-inner-nav', () => ({ default: () => null }))
vi.mock('@/lib/staff-role', async (original) => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => 'owner', useStaffIdentity: () => ({ role: 'owner', readOnly: false }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/emergency',
  useSearchParams: () => new URLSearchParams(`tab=${state.tab}`),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ accounts: [], selectedAccountId: 'account-1', selectedAccount: null, loading: false }),
}))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      health: {
        ...actual.api.health,
        accounts: () => {
          state.accountCalls += 1
          const next = state.accounts.shift()
          return (next ? next() : Promise.resolve({ success: true, data: [] })) as Promise<never>
        },
      },
      operations: {
        ...actual.api.operations,
        health: () => new Promise(() => undefined) as Promise<never>,
        alerts: () => Promise.resolve({ success: true, data: [] }) as Promise<never>,
        history: () => Promise.resolve({ success: true, data: [] }) as Promise<never>,
        lineReceipts: () => Promise.resolve({ success: true, data: [] }) as Promise<never>,
      },
    },
  }
})

afterEach(() => {
  cleanup()
  state.tab = 'health'
  state.accountCalls = 0
  state.accounts = []
})

async function renderScreen(tab: string) {
  state.tab = tab
  const view = render(<EmergencyScreen renderControl={() => <p>緊急コントロールの中身</p>} renderHistory={() => <p>更新履歴の中身</p>} />)
  await act(async () => { await Promise.resolve() })
  return view
}

async function openHelp() {
  fireEvent.click(screen.getByRole('button', { name: '運用状態の説明' }))
  await act(async () => { await Promise.resolve() })
}

describe('運用状態の外側', () => {
  it('健全性チェックは板 Y4LkX1。タブは板の並びで、題は1つ、h1 を重ねない', async () => {
    const view = await renderScreen('health')
    expect(view.container.querySelector('[data-page-template="settings"]')?.getAttribute('data-design-node')).toBe('Y4LkX1')
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['健全性チェック', '更新履歴', '緊急コントロール', 'セキュリティの見張り'])
    expect(screen.getByRole('tab', { name: '健全性チェック' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('heading', { name: '運用状態' })).toBeTruthy()
    // 画面の題が唯一の h1。上の帯のパンくずは見出しにしないので、h1 は題の1つだけ。
    expect([...view.container.querySelectorAll('h1')].map((el) => el.textContent)).toEqual(['運用状態'])
    expect(screen.getByRole('button', { name: 'いますぐ確かめる' })).toBeTruthy()
    await openHelp()
    expect(screen.getByText(/9 つの項目を5分ごとに自動で確かめます。/)).toBeTruthy()
  })

  it('緊急コントロールは板 OHwbU。説明は止め方で、オーナーには緊急停止の主ボタンを出す', async () => {
    const view = await renderScreen('control')
    expect(view.container.querySelector('[data-page-template="settings"]')?.getAttribute('data-design-node')).toBe('OHwbU')
    expect(screen.getByText('緊急コントロールの中身')).toBeTruthy()
    expect(screen.getByRole('button', { name: '緊急停止する' })).toBeTruthy()
    await openHelp()
    expect(screen.getByText('止める配信を選び、理由を入力して緊急停止します。')).toBeTruthy()
  })

  it('更新履歴は板 I2V65v。説明は時間順の記録', async () => {
    const view = await renderScreen('history')
    expect(view.container.querySelector('[data-page-template="settings"]')?.getAttribute('data-design-node')).toBe('I2V65v')
    expect(screen.getByText('更新履歴の中身')).toBeTruthy()
    await openHelp()
    expect(screen.getByText('エラー、緊急停止、システム更新、設定変更を時間順に確認できます。')).toBeTruthy()
  })
})

describe('アカウント一覧の取得失敗', () => {
  it('失敗の応答は黙らせず、読み直して成功すれば知らせを消す', async () => {
    state.accounts = [() => Promise.resolve({ success: false, error: 'down' })]
    await renderScreen('health')
    expect(await screen.findByText(/アカウント一覧を読み込めませんでした。/)).toBeTruthy()
    expect(state.accountCalls).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
    await waitFor(() => expect(screen.queryByText(/アカウント一覧を読み込めませんでした。/)).toBeNull())
    expect(state.accountCalls).toBe(2)
  })

  it('通信の失敗（例外）も黙らせない', async () => {
    state.accounts = [() => Promise.reject(new Error('network down'))]
    await renderScreen('control')
    expect(await screen.findByText(/アカウント一覧を読み込めませんでした。/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'もう一度読み込む' })).toBeTruthy()
  })
})
