// @vitest-environment happy-dom
/*
 * M004・M005（集まった回答）の試験。本物の React で確かめる。
 *
 * - M004：後処理の再実行の失敗（403・500・通信断）で内部文・英語文が出ず、
 *   日本語の理由と立て直し方が出る。口が返した日本語の理由はそのまま出す。
 * - M005：読み込み403で権限不足と分かり、再試行は出ない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const net = vi.hoisted(() => ({
  /** 一覧の読み込みの失敗のさせ方。 */
  loadBehavior: 'ok' as 'ok' | 'forbidden',
  /** 再実行の失敗のさせ方。 */
  retryBehavior: 'ok' as 'ok' | 'forbidden' | 'serverError' | 'offline' | 'japanese',
}))

const fetchApi = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return { ...actual, fetchApi }
})

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams('id=form-1'),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {} }))

import FormResponsesPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const formDetail = {
  id: 'form-1',
  name: 'アンケート',
  fields: [{ name: 'q1', label: '質問1' }],
  layout: { version: 2, header: [], sections: [], options: {} },
  submitCount: 3,
}

const submissionsPage = {
  items: [
    {
      id: 'sub-1', formId: 'form-1', friendId: 'friend-1', friendName: '山田',
      data: { q1: '駐車場' },
      destinationWrite: { status: 'failed', attempted: 1, succeeded: 0, failed: 1 },
      postActions: { state: 'failed', pending: ['webhook'] },
      createdAt: '2026-09-01T10:00:00+09:00',
    },
  ],
  total: 1,
  page: 1,
  limit: 20,
}

function mockResponses() {
  fetchApi.mockImplementation((async (url: string) => {
    if (url.includes('/retry-effects')) {
      if (net.retryBehavior === 'forbidden') {
        const { ApiError } = await import('@/lib/api')
        throw new ApiError(403, 'API error: 403')
      }
      if (net.retryBehavior === 'serverError') {
        const { ApiError } = await import('@/lib/api')
        throw new ApiError(500, 'API error: 500')
      }
      if (net.retryBehavior === 'offline') throw new TypeError('Failed to fetch')
      if (net.retryBehavior === 'japanese') {
        return { success: false, error: '後処理の記録がありませんでした。一覧を読み直してください。' }
      }
      return { success: true, data: { submission: submissionsPage.items[0], pendingEffects: [] } }
    }
    if (url.startsWith('/api/forms/form-1/submissions')) {
      return { success: true, data: submissionsPage }
    }
    if (net.loadBehavior === 'forbidden') {
      const { ApiError } = await import('@/lib/api')
      throw new ApiError(403, 'API error: 403')
    }
    return { success: true, data: formDetail }
  }) as typeof fetchApi)
}

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

function findButton(text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')]
    .find((node) => (node.textContent ?? '').includes(text)) as HTMLButtonElement | undefined
}

async function openDetail() {
  const row = host.querySelector('tr.cursor-pointer')
  expect(row, '回答の行がある').toBeTruthy()
  await act(async () => {
    ;(row as HTMLElement).click()
  })
  await settle()
  const retry = findButton('後処理をやり直す')
  expect(retry, '再実行ボタンがある').toBeTruthy()
  return retry!
}

describe('M004 後処理の再実行の失敗は日本語の理由と立て直し方で出す', () => {
  beforeEach(() => {
    net.loadBehavior = 'ok'
    net.retryBehavior = 'ok'
    fetchApi.mockReset()
    mockResponses()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('403では権限の確認が出て、内部文は出ない', async () => {
    net.retryBehavior = 'forbidden'
    await act(async () => {
      root.render(<FormResponsesPage />)
    })
    await settle()
    const retry = await openDetail()
    await act(async () => {
      retry.click()
    })
    await settle()
    expect(host.textContent).toContain('権限')
    expect(host.textContent).not.toContain('API error')
  })

  it('500では時間をおいての再試行が出て、内部文は出ない', async () => {
    net.retryBehavior = 'serverError'
    await act(async () => {
      root.render(<FormResponsesPage />)
    })
    await settle()
    const retry = await openDetail()
    await act(async () => {
      retry.click()
    })
    await settle()
    expect(host.textContent).toContain('時間をおいて')
    expect(host.textContent).not.toContain('API error')
  })

  it('通信断では日本語の案内が出て、英語文は出ない', async () => {
    net.retryBehavior = 'offline'
    await act(async () => {
      root.render(<FormResponsesPage />)
    })
    await settle()
    const retry = await openDetail()
    await act(async () => {
      retry.click()
    })
    await settle()
    expect(host.textContent).not.toContain('Failed to fetch')
    expect(host.textContent).toContain('もう一度お試しください')
  })

  it('口が返した日本語の理由はそのまま出す', async () => {
    net.retryBehavior = 'japanese'
    await act(async () => {
      root.render(<FormResponsesPage />)
    })
    await settle()
    const retry = await openDetail()
    await act(async () => {
      retry.click()
    })
    await settle()
    expect(host.textContent).toContain('後処理の記録がありませんでした')
  })
})

describe('M005 読み込み403は権限不足と分かり、再試行は出ない', () => {
  beforeEach(() => {
    net.loadBehavior = 'forbidden'
    net.retryBehavior = 'ok'
    fetchApi.mockReset()
    mockResponses()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('権限不足の案内と一覧への戻り方が出る', async () => {
    await act(async () => {
      root.render(<FormResponsesPage />)
    })
    await settle()
    expect(host.textContent).toContain('権限がありません')
    // 再試行ボタンは出さない。
    expect(findButton('もう一度読み込む')).toBeUndefined()
    // 一覧への戻り方は出す。
    expect(host.textContent).toContain('回答フォーム一覧へ戻る')
  })
})
