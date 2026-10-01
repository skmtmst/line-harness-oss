// @vitest-environment happy-dom
/*
 * M032 追加残差: 宛先の回復で保存ガード由来の古い文言を消す。
 *
 * preview503 → 下書き保存のガード（送信なし）→ 同画面の再試行200で
 * 宛先1人が正常に戻っても、古いガード文言が残り、指していた再読込
 * ボタンは消える。回復時にガード由来の文言だけを解消することを
 * 本物の React で確かめる。他の保存・検証文言は消さない。
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
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: fixture.push }),
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: null, loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
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

const GUARD = '取り直してから保存してください'

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

describe('M032 宛先の回復で保存ガード由来の古い文言を消す', () => {
  it('preview503→保存ガード→再試行200で古いガード文言が消える', async () => {
    fixture.previewRecipients
      .mockRejectedValueOnce(new ApiError(503))
      .mockResolvedValue(STAFF)
    render(<NewOperatorNotificationPage />)

    const retry = await screen.findByRole('button', { name: 'もう一度読み込む' })
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存する' }))
    // 保存ガードが出て、作成・公開・テスト送信は送らない。
    await waitFor(() => expect(screen.getByText(new RegExp(GUARD))).toBeTruthy())
    expect(fixture.create).not.toHaveBeenCalled()
    expect(fixture.updateDraft).not.toHaveBeenCalled()
    expect(fixture.publish).not.toHaveBeenCalled()
    expect(fixture.test).not.toHaveBeenCalled()

    // 同画面の再試行で宛先1人が正常に戻る。
    fireEvent.click(retry)
    await waitFor(() => expect(screen.getByText('花子')).toBeTruthy())
    // 指していた再読込ボタンは消え、古いガード文言も消える。
    await waitFor(() => expect(screen.queryByRole('button', { name: 'もう一度読み込む' })).toBeNull())
    expect(screen.queryByText(new RegExp(GUARD))).toBeNull()
  })

  it('別原因の保存文言は宛先の回復で消えない', async () => {
    fixture.previewRecipients
      .mockRejectedValueOnce(new ApiError(503))
      .mockResolvedValue(STAFF)
    render(<NewOperatorNotificationPage />)

    const retry = await screen.findByRole('button', { name: 'もう一度読み込む' })
    // 名前を空にして別原因（入力検証）の保存文言を出す。
    const nameInput = document.getElementById('operator-name')
    if (!nameInput) throw new Error('名前の入力が見つかりません')
    fireEvent.change(nameInput, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存する' }))
    await waitFor(() => expect(screen.getByText('お知らせの名前を入力してください。')).toBeTruthy())

    // 宛先が回復しても別原因の文言は残る。
    fireEvent.click(retry)
    await waitFor(() => expect(screen.getByText('花子')).toBeTruthy())
    expect(screen.getByText('お知らせの名前を入力してください。')).toBeTruthy()
  })
})
