// @vitest-environment happy-dom
import { readUiSource } from '../../scripts/test-ui-source.mjs'
import path from 'node:path'
import { createElement } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'

import { afterEach, describe, expect, it, vi } from 'vitest'

const APP = path.join(__dirname)
const source = (relativePath: string) => readUiSource(path.join(APP, relativePath), 'utf8')

const mocks = vi.hoisted(() => ({
  pageTitle: vi.fn(),
  performance: vi.fn(),
  notifications: vi.fn(),
}))

vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))
vi.mock('@/components/shell/page-chrome', async () => ({
  ...(await import('@/test-utils/page-chrome-mock')).pageChromeMock(),
  usePageTitle: mocks.pageTitle,
}))
vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      searchConsole: { performance: mocks.performance },
      notifications: {
        center: {
          list: mocks.notifications,
          markRead: async () => ({ success: true }),
          markAllRead: async () => ({ success: true }),
        },
      },
    },
  }
})

const pages = [
  'reminders/edit/page.tsx',
  'notifications/page.tsx',
  'search-console/page.tsx',
  'pools/page.tsx',
]

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('機能7・20・24・33の本文上部', () => {
  it.each(pages)('%s は旧Headerを描かない', (relativePath) => {
    const page = source(relativePath)
    expect(page).not.toContain("from '@/components/layout/header'")
    expect(page).not.toContain('<Header')
  })

  it('通知一覧の画面名はトップバーへ渡す', async () => {
    // N-009: /notifications は未対応インボックスではなく通知の全件一覧になった。
    mocks.notifications.mockResolvedValue({ success: true, data: { items: [], counts: { all: 0, error: 0, update: 0, unread: 0 }, unreadCount: 0 } })
    const { default: NotificationsPage } = await import('./notifications/page')
    render(createElement(NotificationsPage))
    await waitFor(() => expect(mocks.notifications).toHaveBeenCalled())
    expect(mocks.pageTitle).toHaveBeenCalledWith('通知')
  })

  it('Search ConsoleはV8の見出しに書き出し・連携の操作を残す', async () => {
    mocks.performance.mockResolvedValue({
      success: true,
      data: {
        status: 'connected', siteUrl: 'https://example.com/', startDate: '2026-08-01', endDate: '2026-08-28', rangeDays: 28,
        summary: { clicks: 120, impressions: 3000, ctr: 0.04, position: 8.5 },
        previousSummary: { clicks: 100, impressions: 2800, ctr: 0.035, position: 9.1 },
        daily: [{ key: '2026-08-01', clicks: 10, impressions: 200, ctr: 0.05, position: 8 }],
        queries: [], pages: [], devices: [], fetchedAt: '2026-08-29T00:00:00+09:00',
      },
    })
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:search-console')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const downloads: string[] = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download) })
    const { default: SearchConsolePage } = await import('./search-console/page')
    const view = render(createElement(SearchConsolePage))
    expect(mocks.pageTitle).toHaveBeenCalledWith('Search Console')
    expect(view.container.querySelector('[data-page-template="list"]')).not.toBeNull()
    const exportButton = await screen.findByRole('button', { name: 'CSVで書き出す' })
    await waitFor(() => expect((exportButton as HTMLButtonElement).disabled).toBe(false))
    await act(async () => { exportButton.click() })
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(downloads).toHaveLength(1)
    expect(downloads[0]).toContain('Search Console')
    expect(screen.getByRole('link', { name: '連携を設定' }).getAttribute('href'))
      .toBe('https://search.google.com/search-console/users?resource_id=https%3A%2F%2Fexample.com%2F')
    click.mockRestore()
    createObjectURL.mockRestore()
    revokeObjectURL.mockRestore()
  })
})
