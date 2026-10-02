// @vitest-environment happy-dom
/*
 * R521: 補助の一覧（受け取り先の名前）だけが503でも、引継ぎの本体を隠さない。
 * 本体と補助で成否を分け、補助だけ読み直せることを実マウントで固定する。
 * 監査ケース 179-002（本人・引継GET成功＋一覧GETのみ503で全体失敗）の再現。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const staffMe = vi.hoisted(() => vi.fn())
const accountsGet = vi.hoisted(() => vi.fn())
const accountsList = vi.hoisted(() => vi.fn())
const handoversForAccount = vi.hoisted(() => vi.fn())
const handoverGet = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      staff: { ...actual.api.staff, me: staffMe },
      lineAccounts: { ...actual.api.lineAccounts, get: accountsGet, list: accountsList },
      accountHandovers: {
        ...actual.api.accountHandovers,
        listForAccount: handoversForAccount,
        get: handoverGet,
      },
    },
  }
})

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('id=account-1'),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
}))

import HandoverPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const account = { id: 'account-1', name: '本店', channelId: 'ch-1' }
const branch = { id: 'account-2', name: '支店', channelId: 'ch-2' }

const detail = {
  id: 'h-1',
  fromAccountId: 'account-1',
  toAccountId: 'account-2',
  code: 'ABC123',
  status: 'linked',
  providerMatch: 'same',
  counts: { sourceTotal: 2, auto: 1, review: 1, unmatched: 0, lookalike: 0 },
  declaredFriendTotal: null,
  rollbackDeadline: null,
  rolledBackAt: null,
  linkedAt: '2026-09-28T00:00:00.000Z',
  decisions: [
    {
      id: 'd-1',
      from_friend_id: 'f-1',
      to_friend_id: 'f-2',
      decision: 'link',
      bucket: 'review',
      note: '名前が一致',
      sourceName: '山田',
      candidateName: '山田',
      evidenceLabel: '名前が一致',
    },
  ],
  unresolvedReviews: 1,
}

function findButton(label: string): HTMLButtonElement | null {
  const found = [...host.querySelectorAll('button')].find(
    (el) => el.textContent?.trim() === label,
  )
  return (found as HTMLButtonElement | undefined) ?? null
}

beforeEach(() => {
  staffMe.mockImplementation(async () => ({ success: true, data: { role: 'owner' } }))
  accountsGet.mockImplementation(async () => ({ success: true, data: account }))
  handoversForAccount.mockImplementation(async () => ({ success: true, data: [{ id: 'h-1' }] }))
  handoverGet.mockImplementation(async () => ({ success: true, data: detail }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.clearAllMocks()
})

async function flush() {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

describe('R521 補助の一覧だけ失敗しても本体は隠さない', () => {
  it('一覧が success:false でも引継ぎの内容が出て、一覧だけ読み直せる', async () => {
    accountsList.mockImplementation(async () => ({ success: false, error: 'Service Unavailable' }))
    await act(async () => {
      root.render(<HandoverPage />)
    })
    await flush()

    // 本体はそのまま見られる。
    expect(host.textContent).toContain('どこからどこへ')
    expect(host.textContent).toContain('ABC123')
    // 画面全体の失敗にはしない。
    expect(host.textContent).not.toContain('乗り換えの情報を読み込めませんでした')
    // 補助だけの失敗を帯で知らせ、ここだけ読み直せる。
    expect(host.textContent).toContain('受け取り先の一覧だけ読み込めませんでした')
    expect(findButton('一覧だけ読み直す')).not.toBeNull()
    // 受け取り先の名前はまだ取れていない。
    expect(host.textContent).toContain('未取得')
  })

  it('一覧が例外（503相当）でも引継ぎの内容が出る', async () => {
    accountsList.mockImplementation(async () => {
      throw new Error('API error: 503')
    })
    await act(async () => {
      root.render(<HandoverPage />)
    })
    await flush()

    expect(host.textContent).toContain('どこからどこへ')
    expect(host.textContent).not.toContain('乗り換えの情報を読み込めませんでした')
    expect(findButton('一覧だけ読み直す')).not.toBeNull()
  })

  it('一覧だけ読み直すと受け取り先の名前が出て、帯が消える', async () => {
    accountsList.mockImplementation(async () => ({ success: false, error: 'Service Unavailable' }))
    await act(async () => {
      root.render(<HandoverPage />)
    })
    await flush()
    expect(findButton('一覧だけ読み直す')).not.toBeNull()

    accountsList.mockImplementation(async () => ({ success: true, data: [account, branch] }))
    await act(async () => {
      findButton('一覧だけ読み直す')?.click()
    })
    await flush()

    expect(host.textContent).toContain('支店')
    expect(host.textContent).not.toContain('受け取り先の一覧だけ読み込めませんでした')
    // 本体は読み直しで消えない。
    expect(host.textContent).toContain('ABC123')
  })

  it('本体（本人）が失敗したときは今までどおり画面全体の失敗になる', async () => {
    accountsGet.mockImplementation(async () => ({ success: false, error: 'Service Unavailable' }))
    accountsList.mockImplementation(async () => ({ success: true, data: [account, branch] }))
    await act(async () => {
      root.render(<HandoverPage />)
    })
    await flush()

    expect(host.textContent).toContain('乗り換えの情報を読み込めませんでした')
  })
})
