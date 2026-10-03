// @vitest-environment happy-dom
/*
 * V8の集まった回答（v0SbYR・MKQyJ）を本物の React で確かめる。
 * テーマは `<html data-theme>` で替わるので、描画前に v8 を付ける。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  name: '来店アンケート',
  fields: [
    { name: 'purpose', label: '今日のご来店の目的は？' },
    { name: 'comment', label: 'ご意見・ご要望' },
  ],
  layout: {
    version: 2,
    header: [],
    sections: [
      {
        id: 's1',
        name: '質問',
        blocks: [
          {
            id: 'b1', kind: 'input', type: 'radio', name: 'purpose',
            label: '今日のご来店の目的は？', required: true,
            choices: [{ id: 'c1', label: 'トリミング' }, { id: 'c2', label: '相談' }],
          },
          {
            id: 'b2', kind: 'input', type: 'textarea', name: 'comment',
            label: 'ご意見・ご要望', required: false,
          },
        ],
      },
    ],
    options: {},
  },
  submitCount: 2,
}

const submissionsPage = {
  items: [
    {
      id: 'sub-1', formId: 'form-1', friendId: 'friend-1', friendName: 'ココ',
      data: { purpose: 'トリミング', comment: '待ち時間が短くて助かりました' },
      destinationWrite: { status: 'succeeded', attempted: 1, succeeded: 1, failed: 0 },
      postActions: { state: 'failed', pending: ['tag'] },
      createdAt: '2026-09-30T17:40:00+09:00',
    },
  ],
  total: 1,
  page: 1,
  limit: 20,
  summary: { startedUnique: 2, submitted: 1, completionRate: 50, destinationWrites: { pending: 0, succeeded: 1, partial: 0, failed: 0, not_requested: 0, unknown: 0 }, dateAnsweredUniqueFriends: 1, dateFields: [] },
}

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

function tabButton(label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('[role="tab"]')]
    .find((node) => (node.textContent ?? '').includes(label)) as HTMLButtonElement | undefined
}

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  fetchApi.mockImplementation((async (url: string) => {
    if (url.startsWith('/api/forms/form-1/submissions')) return { success: true, data: submissionsPage }
    return { success: true, data: formDetail }
  }) as typeof fetchApi)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  host.remove()
  document.documentElement.dataset.theme = ''
})

describe('V8 集まった回答', () => {
  it('まとめて見るから始まり、棒と自由記述が出る（v0SbYR）', async () => {
    await act(async () => {
      root.render(<FormResponsesPage />)
    })
    await settle()
    expect(tabButton('まとめて見る')?.getAttribute('aria-selected')).toBe('true')
    expect(host.textContent).toContain('集まった回答：来店アンケート')
    expect(host.textContent).toContain('今日のご来店の目的は？')
    expect(host.textContent).toContain('ラジオ')
    expect(host.textContent).toContain('ご意見・ご要望')
    expect(host.textContent).toContain('待ち時間が短くて助かりました')
  })

  it('1件ずつ見るで表・札・右の詳細が出る（MKQyJ）', async () => {
    await act(async () => {
      root.render(<FormResponsesPage />)
    })
    await settle()
    await act(async () => {
      tabButton('1件ずつ見る')?.click()
    })
    await settle()
    expect(host.textContent).toContain('未完')
    const row = host.querySelector('tbody tr')
    expect(row, '回答の行がある').toBeTruthy()
    await act(async () => {
      ;(row as HTMLElement).click()
    })
    await settle()
    expect(host.textContent).toContain('回答の詳細：ココ')
    expect(host.textContent).toContain('タグ付け')
    expect(host.textContent).toContain('後処理をやり直す')
  })
})
