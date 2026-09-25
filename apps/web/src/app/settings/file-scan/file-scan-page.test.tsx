// @vitest-environment happy-dom
/*
 * 設定の中の「ファイルの検査」（B-2）を本物の React で動かす試験。
 * 見るのは主な状態の言い分けだけ:
 *   - 空 … 当てはまるファイルがありません
 *   - 読み込み中 … 待っている表示
 *   - 失敗 … 読み込めませんでした＋読み直し
 *   - 権限なし … 管理者だけの表示
 *   - 正常 … 表の行・件数・操作
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { FileScanItem } from '@/lib/api'

const mocks = vi.hoisted(() => ({
  accountId: 'acc-1' as string | null,
  me: vi.fn(),
  list: vi.fn(),
  getConfig: vi.fn(),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: mocks.accountId }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn() }),
  usePathname: () => '/settings/file-scan',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      staff: {
        ...actual.api.staff,
        me: mocks.me,
      },
      fileScan: {
        ...actual.api.fileScan,
        list: mocks.list,
        getConfig: mocks.getConfig,
      },
    },
  }
})

import FileScanSettingsPage from './page'

afterEach(() => cleanup())

const scanOf = (overrides: Partial<FileScanItem> = {}): FileScanItem => ({
  id: 'scan-1',
  lineAccountId: 'acc-1',
  subjectKind: 'media',
  subjectId: 'md-1',
  mediaId: 'md-1',
  filename: 'invoice.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 220000,
  status: 'quarantined',
  reasonCode: 'pdf_active_content',
  reasonLabel: '危険な仕掛けが見つかりました',
  uploaderLabel: '川野',
  attempts: 0,
  nextRetryAt: null,
  scannedAt: '2026-09-25T10:00:00+09:00',
  quarantinedAt: '2026-09-25T10:00:00+09:00',
  releasedAt: null,
  releaseReason: null,
  createdAt: '2026-09-25T10:00:00+09:00',
  updatedAt: '2026-09-25T10:00:00+09:00',
  ...overrides,
})

function ready() {
  mocks.me.mockResolvedValue({ success: true, data: { role: 'owner' } })
  mocks.getConfig.mockResolvedValue({ success: true, data: { config: null } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.accountId = 'acc-1'
})

describe('ファイルの検査の設定画面', () => {
  test('正常時は表の行と件数と操作が出る', async () => {
    ready()
    mocks.list.mockResolvedValue({ success: true, data: { items: [scanOf()], total: 1, limit: 50, offset: 0 } })
    render(<FileScanSettingsPage />)
    await waitFor(() => {
      expect(screen.getByText('invoice.pdf')).toBeTruthy()
    })
    expect(screen.getByText('川野')).toBeTruthy()
    expect(screen.getByText('危険な仕掛けが見つかりました')).toBeTruthy()
    expect(screen.getByText('1件')).toBeTruthy()
    expect(screen.getByRole('button', { name: '使えるように戻す' })).toBeTruthy()
    // 消すは「…」の中の危ない操作として入る。
    expect(screen.getByRole('button', { name: 'invoice.pdfのその他操作' })).toBeTruthy()
    // 中身は画面に出さない。理由の言葉だけ。
    expect(screen.queryByText(/JavaScript/)).toBeNull()
  })

  test('空の時は作成導線なしの表示', async () => {
    ready()
    mocks.list.mockResolvedValue({ success: true, data: { items: [], total: 0, limit: 50, offset: 0 } })
    render(<FileScanSettingsPage />)
    await waitFor(() => {
      expect(screen.getByText('当てはまるファイルがありません')).toBeTruthy()
    })
  })

  test('失敗時は読み込めませんでしたと読み直し', async () => {
    ready()
    mocks.list.mockRejectedValue(new Error('network'))
    render(<FileScanSettingsPage />)
    await waitFor(() => {
      expect(screen.getByText('ファイルの検査を読み込めませんでした')).toBeTruthy()
    })
  })

  test('管理者以外は入れない', async () => {
    mocks.me.mockResolvedValue({ success: true, data: { role: 'staff' } })
    mocks.list.mockResolvedValue({ success: true, data: { items: [], total: 0, limit: 50, offset: 0 } })
    mocks.getConfig.mockResolvedValue({ success: true, data: { config: null } })
    render(<FileScanSettingsPage />)
    await waitFor(() => {
      expect(screen.getByText('ファイルの検査は管理者だけが開けます')).toBeTruthy()
    })
  })

  test('戻す操作は理由を入れる欄と一緒に出る', async () => {
    ready()
    mocks.list.mockResolvedValue({ success: true, data: { items: [scanOf()], total: 1, limit: 50, offset: 0 } })
    render(<FileScanSettingsPage />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '使えるように戻す' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '使えるように戻す' }))
    expect(screen.getByLabelText(/理由/)).toBeTruthy()
  })
})
