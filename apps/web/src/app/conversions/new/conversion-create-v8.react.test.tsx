// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import NewConversionPage from './page'

const st = vi.hoisted(() => ({
  accountId: 'account-a' as string | null,
  created: [] as unknown[],
  pushed: [] as string[],
  role: 'admin',
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: (url: string) => { st.pushed.push(url) } }) }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: st.accountId,
    selectedAccount: { id: 'account-a', name: 'A店' },
    accounts: [{ id: 'account-a', name: 'A店' }],
  }),
}))
vi.mock('@/lib/staff-role', () => ({
  canManageRole: (role: string) => role === 'owner' || role === 'admin',
  useStaffRole: () => st.role,
}))
vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    status: number
    constructor(status: number, message?: string) {
      super(message ?? `API error: ${status}`)
      this.status = status
    }
  }
  return {
    ApiError,
    api: {
      conversions: {
        points: async () => ({
          success: true,
          data: [{ id: 'cv-1', name: '商品を買った', lineAccountId: 'account-a' }],
        }),
        previewDefinition: async () => ({
          success: true,
          data: {
            estimatedCount: 52, estimatedValue: 412000, dailyAverage: 2,
            duplicateExcludedCount: 2, cancellationCount: 1, excludedReasons: [],
          },
        }),
        createDefinition: async (payload: unknown) => {
          st.created.push(payload)
          return { success: true, data: { id: 'cv-new' } }
        },
      },
      analytics: { v6Funnels: { list: async () => ({ success: true, data: [] }) } },
      automations: { list: async () => ({ success: true, data: [] }) },
      nenCampaigns: { settings: async () => ({ success: true, data: [] }) },
      featureSettings: {
        visibility: async () => ({ success: true, data: { features: {} } }),
      },
      tags: { list: async () => ({ success: true, data: [] }) },
      friendFields: { list: async () => ({ success: true, data: [] }) },
      supportMarks: { list: async () => ({ success: true, data: [] }) },
      scenarios: { list: async () => ({ success: true, data: [] }) },
    },
  }
})

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  st.accountId = 'account-a'
  st.created = []
  st.pushed = []
  st.role = 'admin'
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  document.documentElement.removeAttribute('data-theme')
  cleanup()
})

async function renderPage() {
  await act(async () => root.render(<NewConversionPage />))
}

async function eventually(check: () => void, timeout = 8000) {
  const started = Date.now()
  while (true) {
    try { check(); return } catch (error) {
      if (Date.now() - started >= timeout) throw error
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    }
  }
}

function setName(value: string) {
  const input = screen.getByLabelText('成果地点の名前') as HTMLInputElement
  fireEvent.change(input, { target: { value } })
}

describe('★V8-B 成果地点を作る（j8p3yj・競合cXqlS）', () => {
  it('v8 の下では Pencil j8p3yj の新しい作る画面に切り替わる', async () => {
    document.documentElement.dataset.theme = 'v8'
    await renderPage()
    await eventually(() => {
      expect(host.querySelector('[data-design-node="j8p3yj"]')).toBeTruthy()
    })
    expect(host.textContent).toContain('成果地点を作る')
    expect(host.textContent).toContain('何が起きたら数えますか')
    expect(host.textContent).toContain('同じ人を何回まで数えるか')
    expect(host.textContent).toContain('金額をどう出すか')
    expect(host.textContent).toContain('数えない条件')
    expect(host.textContent).toContain('この決めごとをこの30日にあてはめると')
    expect(host.textContent).toContain('この成果地点を使う場所')
    // 下の帯の3つ
    expect(screen.getByRole('button', { name: '保存して続けて作る' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '保存して数えはじめる' })).toBeTruthy()
    // 試算（250ms待ってから読む）
    await eventually(() => {
      expect(host.textContent).toContain('52件')
    })
  })

  it('v8 で同名があると競合の帯が出て、比べる先へ飛べる', async () => {
    document.documentElement.dataset.theme = 'v8'
    await renderPage()
    await eventually(() => {
      expect(host.querySelector('[data-design-node="j8p3yj"]')).toBeTruthy()
    })
    setName('商品を買った')
    await eventually(() => {
      expect(host.textContent).toContain('同じ名前の「商品を買った」があります')
    })
    expect(host.textContent).toContain('違いを比べる')
    expect(host.textContent).toContain('最新を読み込んで続ける')
    const compare = screen.getByRole('link', { name: '違いを比べる' }) as HTMLAnchorElement
    expect(compare.getAttribute('href')).toContain('highlight=cv-1')
    // 競合のあいだ主なボタンは「比べてから保存」になる
    expect(screen.getByRole('link', { name: '比べてから保存' })).toBeTruthy()
  })

  it('v8 で名前が空のまま保存すると案内が出て、入れると作って一覧へ戻る', async () => {
    document.documentElement.dataset.theme = 'v8'
    await renderPage()
    await eventually(() => {
      expect(host.querySelector('[data-design-node="j8p3yj"]')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '保存して数えはじめる' }))
    await eventually(() => {
      expect(host.textContent).toContain('成果地点の名前を入力してください')
    })
    expect(st.created).toHaveLength(0)
    setName('初めての予約')
    fireEvent.click(screen.getByRole('button', { name: '保存して数えはじめる' }))
    await eventually(() => {
      expect(st.created).toHaveLength(1)
    })
    expect(st.pushed).toEqual(['/conversions?tab=points&highlight=cv-new'])
  })

  it('v8 の閲覧のみでは帯が出て保存が押せない形になる', async () => {
    st.role = 'viewer'
    document.documentElement.dataset.theme = 'v8'
    await renderPage()
    await eventually(() => {
      expect(host.querySelector('[data-design-node="j8p3yj"]')).toBeTruthy()
    })
    expect(host.textContent).toContain('閲覧のみで見ています')
    const primary = screen.getByRole('button', { name: '保存して数えはじめる' }) as HTMLButtonElement
    expect(primary.disabled).toBe(true)
  })
})
