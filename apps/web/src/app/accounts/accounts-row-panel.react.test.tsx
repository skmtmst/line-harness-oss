// @vitest-environment happy-dom
/*
 * アカウント一覧V8の行パネル（サクサク感 C・D・E）。
 * 行を押すと右に詳しい内容（一覧は左のまま・次の行へ移れる）。
 * 右クリックでも詳細ボタンと同じ品ぞろえ。名前はその場で書き換えられる。
 * 詳しい画面へは移り変わりで進む。v7 は行を押しても何も起きない（変えない）。
 */
import React, { act } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LineAccount } from '@line-crm/shared'

const pushes: string[] = []

const apiMock = vi.hoisted(() => ({
  accountsList: vi.fn(),
  accountsUpdate: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    lineAccounts: {
      list: apiMock.accountsList,
      update: apiMock.accountsUpdate,
    },
  },
}))
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (url: string) => { pushes.push(url) }, replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/accounts',
  useParams: () => ({}),
}))

import AccountsPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

const account = (id: string, name: string): LineAccount => ({
  id,
  channelId: `channel-${id}`,
  name,
  loginChannelId: null,
  liffId: null,
  isActive: true,
  channelAccessTokenLast4: null,
  channelAccessTokenUpdatedAt: null,
  channelSecretLast4: null,
  channelSecretUpdatedAt: null,
  loginChannelSecretLast4: null,
  loginChannelSecretUpdatedAt: null,
  isDefault: false,
  archivedAt: null,
})

beforeEach(() => {
  pushes.length = 0
  vi.clearAllMocks()
  document.documentElement.dataset.theme = 'v8'
  apiMock.accountsList.mockResolvedValue({ success: true, data: [account('a1', 'A店'), account('a2', 'B店')] })
  apiMock.accountsUpdate.mockResolvedValue({ success: true, data: {} })
})

afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.theme
})

describe('アカウント一覧V8の行パネル（C・D・E）', () => {
  it('行を押すと詳しい内容が開き、次の行へ移れる', async () => {
    render(<AccountsPage />)
    for (let i = 0; i < 10; i += 1) await flush()
    expect(screen.getByRole('row', { name: /A店の詳しい内容を見る/ }), '行が出る').toBeTruthy()
    fireEvent.click(screen.getByRole('row', { name: /A店の詳しい内容を見る/ }))
    await flush()
    expect(document.body.querySelector('[data-design-part="detail-panel"]')?.textContent).toContain('A店')
    fireEvent.click(screen.getByRole('button', { name: '次の行' }))
    await flush()
    expect(document.body.querySelector('[data-design-part="detail-panel"]')?.textContent).toContain('B店')
  })

  it('名前はその場で書き換えられる', async () => {
    render(<AccountsPage />)
    for (let i = 0; i < 10; i += 1) await flush()
    fireEvent.click(screen.getByRole('row', { name: /A店の詳しい内容を見る/ }))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'アカウント名を変更する' }))
    await flush()
    const input = screen.getByRole('textbox', { name: 'アカウント名' })
    fireEvent.change(input, { target: { value: 'A店・新' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    for (let i = 0; i < 10; i += 1) await flush()
    expect(apiMock.accountsUpdate, '保存の口を叩く').toHaveBeenCalledWith('a1', { name: 'A店・新' })
  })

  it('右クリックでも詳細ボタンと同じ品ぞろえが出る', async () => {
    render(<AccountsPage />)
    for (let i = 0; i < 10; i += 1) await flush()
    const detailButton = screen.getAllByRole('button', { name: '詳細' })[0]
    fireEvent.contextMenu(detailButton)
    await flush()
    expect(screen.getByRole('menuitem', { name: '詳細を開く' }), '詳細を開くがある').toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '詳細を開く' }))
    await flush()
    expect(pushes).toContain('/accounts/detail?id=a1')
  })

  it('v7 は行を押してもパネルは開かない', async () => {
    delete document.documentElement.dataset.theme
    render(<AccountsPage />)
    for (let i = 0; i < 10; i += 1) await flush()
    expect(screen.queryByRole('row', { name: /詳しい内容を見る/ })).toBeNull()
    expect(document.body.querySelector('[data-design-part="detail-panel"]')).toBeNull()
  })
})
