// @vitest-environment happy-dom
/*
 * M032: 運用者へのお知らせ作成画面の失敗表示。
 *
 * - 宛先の読み込み失敗はずっと「読み込んでいます…」のままにしない。
 *   失敗と分かる言葉＋同じ画面での再試行を出す。
 * - 公開・テスト送信の失敗は生の `API error: NNN` を出さず、
 *   describeApiFailure(err, action, { forbidden }) で言い分ける。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  previewRecipients: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  updateDraft: vi.fn(),
  publish: vi.fn(),
  test: vi.fn(),
  push: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))
// 設定の中のメニュー（共通部品）はこの試験の対象外。localStorage と機能の出し分けを読むので外す。
vi.mock('@/components/layout/settings-inner-nav', () => ({ default: () => null }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/line-notifications/operator/new',
  useRouter: () => ({ push: fixture.push }),
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: null, loading: false }),
}))
vi.mock('@/lib/staff-capability', () => ({ isOwnerOrAdmin: () => true }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined, usePageCrumbs: () => undefined, useSettingsNavInline: () => undefined }))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: { notifications: { teams: { list: async () => ({ success: true, data: [] }) } },
      lineNotifications: {
        operatorRules: {
          previewRecipients: fixture.previewRecipients,
          get: fixture.get,
          create: fixture.create,
          updateDraft: fixture.updateDraft,
          publish: fixture.publish,
          test: fixture.test,
        },
      },
    },
  }
})

import { ApiError } from '@/lib/api'
import NewOperatorNotificationPage from './page'

const STAFF = {
  success: true,
  data: {
    items: [{ id: 'staff-a', name: '花子', channels: { line: true, dashboard: true } }],
  },
} as const

beforeEach(() => {
  vi.clearAllMocks()
  fixture.previewRecipients.mockResolvedValue(STAFF)
  fixture.create.mockResolvedValue({ success: true, data: { id: 'rule-1' } })
  fixture.publish.mockResolvedValue({ success: true, data: { id: 'rule-1' } })
  fixture.test.mockResolvedValue({ success: true, data: { accepted: 1 } })
  vi.stubGlobal('React', React)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('M032 宛先の読み込み失敗は読み込み中のままにしない', () => {
  it('失敗したら理由と再試行を出し、直れば宛先を選べる', async () => {
    fixture.previewRecipients
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(STAFF)
    render(<NewOperatorNotificationPage />)

    // 失敗が分かる言葉と、同じ画面での再試行が出る。
    await waitFor(() => expect(screen.getByText(/受け取る人を読み込めませんでした/)).toBeTruthy())
    const retry = await screen.findByRole('button', { name: /もう一度|再読み込み|読み直す/ })
    expect(retry).toBeTruthy()

    fireEvent.click(retry)
    await waitFor(() => expect(fixture.previewRecipients).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText('花子')).toBeTruthy())
  })
})

describe('M032 公開・テスト送信の失敗は生文を出さない', () => {
  it('公開の403は権限の案内にし、`API error` は出さない', async () => {
    fixture.publish.mockRejectedValueOnce(new ApiError(403))
    render(<NewOperatorNotificationPage />)
    await waitFor(() => expect(screen.getByText('花子')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /運用者へのお知らせを公開/ }))
    // 板 `sDXNy`「このお知らせを公開しますか？」を見てから送る。
    const confirm = await screen.findByText('このお知らせを公開しますか？')
    expect(confirm).toBeTruthy()
    const dialog = document.body.querySelector('[data-design-node="sDXNy"]')
    expect(dialog, '公開前の確認の窓が出ない').not.toBeNull()
    for (const row of ['お知らせ', '宛先', 'LINEが届く人', '戻って直す', '管理画面のお知らせだけで届きます']) {
      expect(dialog?.textContent ?? '', `「${row}」がない`).toContain(row)
    }
    const send = screen.getByRole('button', { name: /公開して.*にLINEで送る/ })
    fireEvent.click(send)
    await waitFor(() => expect(screen.getByText(/権限がありません/)).toBeTruthy())
    expect(screen.queryByText(/API error/)).toBeNull()
  })

  it('テスト送信の403は権限の案内にし、`API error` は出さない', async () => {
    fixture.test.mockRejectedValueOnce(new ApiError(403))
    render(<NewOperatorNotificationPage />)
    await waitFor(() => expect(screen.getByText('花子')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: '自分にテストを送る' }))
    await waitFor(() => expect(screen.getByText(/権限がありません/)).toBeTruthy())
    expect(screen.queryByText(/API error/)).toBeNull()
  })
})
