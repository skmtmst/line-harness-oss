// @vitest-environment happy-dom
/*
 * N-171/N-179: 検索条件が一覧とCSVへ同じ値で渡ることを、本物のReactで動かして見る。
 * 見るのは2つだけ: 検索語を打つと一覧取得に `q` が付くこと、CSV書き出しの
 * 全ページ取得にも同じ `q` が付くこと（付けないと画面と書き出しがずれる）。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchUrls: string[] = []
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
    { id: 'sub-1', formId: 'form-1', friendId: 'friend-1', friendName: '山田', data: { q1: '駐車場' }, createdAt: '2026-09-01T10:00:00+09:00' },
  ],
  total: 1,
  page: 1,
  limit: 20,
}

function mockResponses() {
  fetchApi.mockImplementation((async (url: string) => {
    fetchUrls.push(url)
    if (url.startsWith('/api/forms/form-1/submissions')) {
      return { success: true, data: submissionsPage }
    }
    return { success: true, data: formDetail }
  }) as typeof fetchApi)
}

function input(): HTMLInputElement {
  const found = host.querySelector('#form-response-filter')
  if (!(found instanceof HTMLInputElement)) throw new Error('search input not found')
  return found
}

function csvButton(): HTMLButtonElement {
  const buttons = [...host.querySelectorAll('button')]
  const found = buttons.find((button) => button.textContent === 'CSVで書き出す')
  if (!(found instanceof HTMLButtonElement)) throw new Error('csv button not found')
  return found
}

async function settle(milliseconds: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds))
  })
}

describe('N-171/N-179 検索条件の一覧・CSV共有', () => {
  beforeEach(() => {
    fetchUrls.length = 0
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
    vi.restoreAllMocks()
  })

  it('検索語を打つと一覧取得にqが付き、CSVの全ページ取得にも同じqが付く', async () => {
    await act(async () => {
      root.render(<FormResponsesPage />)
    })
    await settle(50)
    const firstList = fetchUrls.filter((url) => url.includes('/submissions?page=1'))
    expect(firstList.length).toBeGreaterThan(0)
    expect(firstList[0]).not.toContain('q=')

    await act(async () => {
      const field = input()
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      if (!setter) throw new Error('value setter not found')
      setter.call(field, '駐車場')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await settle(450)
    const searched = fetchUrls.filter((url) => url.includes('/submissions') && url.includes('q='))
    expect(searched.length).toBeGreaterThan(0)
    for (const url of searched) {
      expect(url).toContain(`q=${encodeURIComponent('駐車場')}`)
    }

    fetchUrls.length = 0
    await act(async () => {
      csvButton().click()
    })
    await settle(100)
    const exported = fetchUrls.filter((url) => url.includes('/submissions'))
    expect(exported.length).toBeGreaterThan(0)
    for (const url of exported) {
      expect(url).toContain(`q=${encodeURIComponent('駐車場')}`)
    }
  })
})
